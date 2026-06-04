/**
 * TARS PR Review workflow (M4).
 *
 * Pipeline (against M3's actual worker API):
 *   1. routing          — resolve policy from projects.yaml
 *   2. fetch-pr         — pull PR metadata + diff
 *   3. iterative dual-review DEBATE (Slice 3):
 *      Round 1: codex-review + claude-review run independently in parallel.
 *      If a finding is raised by only ONE reviewer, we run further rounds
 *      (bounded by MAX_DEBATE_ROUNDS) in which each reviewer is shown the
 *      OTHER's findings and asked to endorse / defend / retract. A finding is
 *      "agreed" once BOTH reviewers endorse it. After the final round:
 *        - findings both endorse  -> agreed       -> pending-approval
 *        - findings still in one side only -> disputed -> disagreement panel
 *        - nothing on either side -> skipped-no-findings
 *      The full transcript is persisted on the run (debate_rounds).
 *   4. triage           — map severities, dedupe, filter by threshold
 *   5. blast-radius     — graph callers (best-effort, never blocks)
 *   6. approval gate    — when reviewers AGREE and findings remain, the run
 *                         stops at `pending-approval`: agreed findings are
 *                         persisted, a Linear issue is created (REF), and the
 *                         dashboard surfaces Approve/Reject. NOTHING is written
 *                         to GitHub here — that happens later (Slice 2) once
 *                         Shaun approves.
 *
 * protect_mode is RETIRED (Slice 1). Review runs on every `auto_review: true`
 * repo; the human approval gate replaces the old write-guard.
 *
 * Worker dispatch uses M3's UUID-based job rows + polling via waitForJob.
 */

import type {
  AgreedFinding,
  DebateReviewerPosition,
  DebateRound,
  DebateTranscript,
} from "./lib/audit";
import { upsertPrReviewRun, writeAudit } from "./lib/audit";
import {
  fetchPR,
  fetchPRDiff,
  fetchPRFiles,
  listOpenPRsTouchingPaths,
} from "./lib/gh";
import { getBlastRadiusForFiles } from "./lib/graph-client";
import { createPendingApprovalIssue } from "./lib/linear-lifecycle";
import {
  type ResolvedPolicy,
  resolvePolicy,
  severityAtLeast,
} from "./lib/policy";
import type { Finding, Severity } from "./lib/schemas";
import { dispatchJob, waitForJob } from "./lib/worker-dispatch";

export interface PRReviewInput {
  owner: string;
  repo: string;
  prNumber: number;
  policyOverride?: Partial<ResolvedPolicy>;
  dryRun?: boolean;
}

export interface PRReviewResult {
  runId: string;
  status:
    | "pending-approval"
    | "skipped-disagreement"
    | "skipped-no-findings"
    | "skipped-policy"
    | "disagreed"
    | "error";
  findingsCount: number;
  reviewCommentUrl?: string;
  linearIssueUrl?: string;
  policy: ResolvedPolicy;
  agreement?: "agree" | "partial" | "disagree";
  prSha?: string;
  error?: string;
}

const WORKER_TIMEOUT_MS = 8 * 60_000;

/**
 * Maximum number of debate rounds (round 1 = independent review, rounds 2..N =
 * exchange). Bounds cost + latency: each extra round dispatches BOTH reviewers
 * again. 3 means: independent review, one exchange, one final exchange.
 */
const MAX_DEBATE_ROUNDS = 3;

// M3 worker severities -> TARS severities.
function mapM3Severity(
  s: "critical" | "high" | "medium" | "low" | "info" | string
): Severity {
  switch (s) {
    case "critical":
      return "critical";
    case "high":
      return "major";
    case "medium":
      return "minor";
    case "low":
      return "minor";
    case "info":
      return "nit";
    default:
      return "minor";
  }
}

interface M3Finding {
  severity: string;
  file?: string;
  line?: number;
  title: string;
  detail: string;
  suggestion?: string;
}

interface M3ReviewResult {
  summary?: string;
  findings?: M3Finding[];
  verdict?: string;
}

function m3ToTarsFindings(m3: M3ReviewResult): Finding[] {
  const out: Finding[] = [];
  for (const f of m3.findings ?? []) {
    out.push({
      file: f.file ?? "(unknown)",
      line: f.line,
      severity: mapM3Severity(f.severity),
      category: "correctness",
      message:
        f.title && f.detail
          ? `${f.title} — ${f.detail}`
          : f.title || f.detail || "(no detail)",
      suggestion: f.suggestion,
    });
  }
  return out;
}

function findingsOverlap(a: Finding, b: Finding): boolean {
  if (a.file !== b.file) {
    return false;
  }
  // Same file. If both have line numbers, accept if within 5 lines.
  if (
    typeof a.line === "number" &&
    typeof b.line === "number" &&
    Math.abs(a.line - b.line) <= 5
  ) {
    return true;
  }
  // Fallback: matching title substring (first 40 chars normalized).
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, "")
      .slice(0, 40);
  return norm(a.message) === norm(b.message);
}

function computeOverlapRatio(
  codexFindings: Finding[],
  claudeFindings: Finding[]
): number {
  if (codexFindings.length === 0 || claudeFindings.length === 0) {
    return 0;
  }
  let overlapping = 0;
  for (const a of codexFindings) {
    if (claudeFindings.some((b) => findingsOverlap(a, b))) {
      overlapping++;
    }
  }
  return overlapping / Math.max(codexFindings.length, 1);
}

// ── Slice 3: debate helpers ──────────────────────────────────────────────────

/** Convert an internal Finding to the slim AgreedFinding shape we persist. */
function toAgreed(f: Finding): AgreedFinding {
  return {
    file: f.file,
    line: f.line,
    severity: f.severity,
    category: f.category,
    message: f.message,
    suggestion: f.suggestion,
  };
}

/**
 * The shape we feed into a reviewer's debateContext (the OTHER side's findings).
 * Kept loose because the worker handler re-parses it with its own zod schema.
 */
interface DebateContextFinding {
  severity?: string;
  file?: string;
  line?: number;
  message?: string;
  suggestion?: string;
}

function toDebateContextFindings(findings: Finding[]): DebateContextFinding[] {
  return findings.map((f) => ({
    severity: f.severity,
    file: f.file,
    line: f.line,
    message: f.message,
    suggestion: f.suggestion,
  }));
}

/** True if `set` contains a finding overlapping `f` (same file+near line / title). */
function setHasOverlap(f: Finding, set: Finding[]): boolean {
  return set.some((g) => findingsOverlap(f, g));
}

/**
 * Given both reviewers' CURRENT-round findings, partition into:
 *  - agreed:   raised (overlapping) by BOTH reviewers
 *  - disputed: raised by exactly one reviewer
 * Agreed findings are deduped (the codex representative is kept).
 */
function partitionFindings(
  codex: Finding[],
  claude: Finding[]
): { agreed: Finding[]; disputed: Finding[] } {
  const agreed: Finding[] = [];
  const disputed: Finding[] = [];

  for (const c of codex) {
    if (setHasOverlap(c, claude)) {
      agreed.push(c);
    } else {
      disputed.push(c);
    }
  }
  for (const cl of claude) {
    if (!setHasOverlap(cl, codex)) {
      disputed.push(cl);
    }
    // claude findings that overlap codex are already represented in `agreed`
    // via their codex counterpart — don't double-count.
  }
  return { agreed: dedupeFindings(agreed), disputed: dedupeFindings(disputed) };
}

function dedupeFindings(findings: Finding[]): Finding[] {
  const seen = new Map<string, Finding>();
  for (const f of findings) {
    const key = `${f.file}|${f.line ?? "?"}|${f.severity}|${f.message.slice(0, 80)}`;
    if (!seen.has(key)) {
      seen.set(key, f);
    }
  }
  return Array.from(seen.values());
}

function uniqStr(values: string[]): string[] {
  return Array.from(new Set(values));
}

type AuditFn = (
  step: string,
  status: "start" | "ok" | "skip" | "error" | "info",
  data?: Record<string, unknown>,
  message?: string
) => Promise<void>;

interface ReviewerRunResult {
  result: M3ReviewResult;
  findings: Finding[];
  jobId: string;
  errorText: string | null;
}

/** The outcome of the full bounded debate, consumed by the workflow body. */
interface DebateResult {
  transcript: DebateTranscript;
  agreed: Finding[];
  disputed: Finding[];
  overlapRatio: number;
  /** Last-round raw results + ids, for the disagreement payload. */
  codexResult: M3ReviewResult;
  claudeResult: M3ReviewResult;
  codexJobId: string;
  claudeJobId: string;
  codexErr: string | null;
  claudeErr: string | null;
  codexCount: number;
  claudeCount: number;
}

/** Dispatch ONE reviewer for ONE round, returning the parsed review. */
async function runReviewer(
  reviewer: "codex" | "claude",
  round: number,
  otherFindings: Finding[] | null,
  ctx: { runId: string; basePayload: Record<string, unknown>; audit: AuditFn }
): Promise<ReviewerRunResult> {
  const kind = reviewer === "codex" ? "codex-review" : "claude-review";
  const payload: Record<string, unknown> = { ...ctx.basePayload };
  if (round > 1 && otherFindings) {
    payload.debateContext = {
      round,
      otherReviewer: reviewer === "codex" ? "claude" : "codex",
      otherFindings: toDebateContextFindings(otherFindings),
    };
  }
  const dispatch = await dispatchJob(kind, payload, {
    idempotencyKey: `${ctx.runId}:${kind}:r${round}`,
    maxAttempts: 2,
  });
  await ctx.audit(kind, "start", { jobId: dispatch.jobId, round });
  const job = await waitForJob(dispatch.jobId, {
    timeoutMs: WORKER_TIMEOUT_MS,
  });
  await ctx.audit(kind, job.status === "done" ? "ok" : "error", {
    status: job.status,
    attempts: job.attempts,
    round,
    errorText: job.errorText?.slice(0, 200),
  });
  const result: M3ReviewResult =
    job.status === "done" && job.result
      ? (job.result as M3ReviewResult)
      : { summary: job.errorText ?? `${kind} unavailable`, findings: [] };
  return {
    result,
    findings: m3ToTarsFindings(result),
    jobId: dispatch.jobId,
    errorText: job.errorText ?? null,
  };
}

function toPosition(
  reviewer: "codex" | "claude",
  result: M3ReviewResult,
  findings: Finding[],
  prev: Finding[] | null
): DebateReviewerPosition {
  const pos: DebateReviewerPosition = {
    reviewer,
    summary: result.summary ?? "",
    findings: findings.map(toAgreed),
  };
  if (prev) {
    // endorsed = present now but not before; retracted = present before, gone now.
    pos.endorsed = findings.filter((f) => !setHasOverlap(f, prev)).length;
    pos.retracted = prev.filter((f) => !setHasOverlap(f, findings)).length;
  }
  return pos;
}

/**
 * Run the bounded iterative debate (round 1 = independent review, rounds 2..N
 * = exchange). Stops early on full convergence or when neither reviewer flags
 * anything; otherwise runs up to MAX_DEBATE_ROUNDS. Extracted from the workflow
 * body so the workflow stays readable; all step calls (dispatch/wait/audit)
 * run in the workflow context via the passed-in closures.
 */
async function runDebate(ctx: {
  runId: string;
  basePayload: Record<string, unknown>;
  audit: AuditFn;
}): Promise<DebateResult> {
  await ctx.audit("debate", "start", { maxRounds: MAX_DEBATE_ROUNDS });

  const rounds: DebateRound[] = [];
  let codexFindings: Finding[] = [];
  let claudeFindings: Finding[] = [];
  let last = {
    codexResult: {} as M3ReviewResult,
    claudeResult: {} as M3ReviewResult,
    codexJobId: "",
    claudeJobId: "",
    codexErr: null as string | null,
    claudeErr: null as string | null,
  };
  let stopReason: DebateTranscript["stopReason"] = "max-rounds";

  for (let round = 1; round <= MAX_DEBATE_ROUNDS; round++) {
    const prevCodex = round > 1 ? codexFindings : null;
    const prevClaude = round > 1 ? claudeFindings : null;
    // Each reviewer sees the OTHER reviewer's PREVIOUS-round findings (round 2+).
    const [codexRun, claudeRun] = await Promise.all([
      runReviewer("codex", round, round > 1 ? claudeFindings : null, ctx),
      runReviewer("claude", round, round > 1 ? codexFindings : null, ctx),
    ]);

    codexFindings = codexRun.findings;
    claudeFindings = claudeRun.findings;
    last = {
      codexResult: codexRun.result,
      claudeResult: claudeRun.result,
      codexJobId: codexRun.jobId,
      claudeJobId: claudeRun.jobId,
      codexErr: codexRun.errorText,
      claudeErr: claudeRun.errorText,
    };

    rounds.push({
      round,
      codex: toPosition("codex", codexRun.result, codexFindings, prevCodex),
      claude: toPosition(
        "claude",
        claudeRun.result,
        claudeFindings,
        prevClaude
      ),
    });

    const { agreed, disputed } = partitionFindings(
      codexFindings,
      claudeFindings
    );
    await ctx.audit("debate-round", "ok", {
      round,
      codex: codexFindings.length,
      claude: claudeFindings.length,
      agreed: agreed.length,
      disputed: disputed.length,
    });

    if (codexFindings.length === 0 && claudeFindings.length === 0) {
      stopReason = "no-findings";
      break;
    }
    if (disputed.length === 0) {
      stopReason = "converged";
      break;
    }
    // Else one-sided findings remain -> another round (until MAX_DEBATE_ROUNDS).
  }

  const { agreed, disputed } = partitionFindings(codexFindings, claudeFindings);
  const overlapRatio = computeOverlapRatio(codexFindings, claudeFindings);
  const transcript: DebateTranscript = {
    rounds,
    maxRounds: MAX_DEBATE_ROUNDS,
    agreed: agreed.map(toAgreed),
    disputed: disputed.map(toAgreed),
    stopReason,
  };

  await ctx.audit("debate", "ok", {
    rounds: rounds.length,
    stopReason,
    agreed: agreed.length,
    disputed: disputed.length,
    overlapRatio,
  });

  return {
    transcript,
    agreed,
    disputed,
    overlapRatio,
    ...last,
    codexCount: codexFindings.length,
    claudeCount: claudeFindings.length,
  };
}

/**
 * Main workflow entry point. "use workflow" at the top of the function so
 * the TypeScript plugin registers it as a durable workflow.
 */
export async function prReviewWorkflow(
  input: PRReviewInput
): Promise<PRReviewResult> {
  "use workflow";

  const runId = `prrev_${input.owner}_${input.repo}_${input.prNumber}_${Date.now()}`;

  const audit = async (
    step: string,
    status: "start" | "ok" | "skip" | "error" | "info",
    data: Record<string, unknown> = {},
    message?: string
  ) => {
    await writeAudit({
      runId,
      workflow: "pr-review",
      step,
      status,
      owner: input.owner,
      repo: input.repo,
      prNumber: input.prNumber,
      message,
      data,
    });
  };

  await audit("start", "start", { input });

  // Insert a baseline `started` row immediately so that even an early step
  // failure (before routing finishes) leaves a row we can mark `error` on
  // in the catch block below.
  await upsertPrReviewRun({
    runId,
    owner: input.owner,
    repo: input.repo,
    prNumber: input.prNumber,
    status: "started",
  });

  // Wrap the entire pipeline so any step failure is recorded against the
  // pr_review_runs row instead of silently leaving it at status=started.
  try {
    // ---------- Step 1: routing ----------
    let policy = await resolvePolicy(input.owner, input.repo);
    if (input.policyOverride) {
      policy = { ...policy, ...input.policyOverride };
    }
    await audit("routing", "ok", { policy });

    await upsertPrReviewRun({
      runId,
      owner: input.owner,
      repo: input.repo,
      prNumber: input.prNumber,
      policy: policy as unknown as Record<string, unknown>,
      status: "started",
    });

    // protect_mode RETIRED (Slice 1): there is no longer a `blocked-konverge`
    // short-circuit here. Review runs on ALL `auto_review: true` repos,
    // including the Konverge / Reflex-Connect repos. The human approval gate
    // (pending-approval -> Approve/Reject) is now the safety boundary — no
    // external write happens until Shaun approves.

    if (!policy.autoReview) {
      await audit("routing", "skip", { reason: "autoReview=false" });
      await upsertPrReviewRun({
        runId,
        owner: input.owner,
        repo: input.repo,
        prNumber: input.prNumber,
        policy: policy as unknown as Record<string, unknown>,
        status: "skipped-policy",
      });
      return { runId, status: "skipped-policy", findingsCount: 0, policy };
    }

    // ---------- Step 2: fetch-pr ----------
    await audit("fetch-pr", "start");
    const pr = await fetchPR(input.owner, input.repo, input.prNumber);
    const _prFiles = await fetchPRFiles(
      input.owner,
      input.repo,
      input.prNumber
    );
    const prDiff = await fetchPRDiff(input.owner, input.repo, input.prNumber);
    await audit("fetch-pr", "ok", {
      headSha: pr.headSha,
      changedFiles: pr.changedFiles,
      additions: pr.additions,
      deletions: pr.deletions,
    });

    await upsertPrReviewRun({
      runId,
      owner: input.owner,
      repo: input.repo,
      prNumber: input.prNumber,
      prSha: pr.headSha,
      // Persist the real PR title + author ON the run (from the GitHub
      // pulls.get response) so the list/detail UI shows them directly without
      // depending on the webhook_events join. Works for webhook- AND
      // manually-triggered runs; coalesced on conflict so later writes keep it.
      prTitle: pr.title,
      prAuthor: pr.user,
      policy: policy as unknown as Record<string, unknown>,
      status: "started",
    });

    // ---------- Step 3: iterative dual-review DEBATE ----------
    // The full bounded debate (round 1 = independent review, rounds 2..N =
    // exchange) is in runDebate(); it runs all reviewer dispatches + audits in
    // this workflow context via the passed closures.
    const debate = await runDebate({
      runId,
      basePayload: {
        diff: prDiff,
        repo: `${input.owner}/${input.repo}`,
        prNumber: input.prNumber,
        context: `Title: ${pr.title}\n\n${pr.body}`,
      },
      audit,
    });

    const {
      transcript: debateTranscript,
      agreed: agreedRaw,
      disputed: disputedRaw,
      overlapRatio,
      codexResult,
      claudeResult,
      codexJobId,
      claudeJobId,
      codexErr,
      claudeErr,
      codexCount,
      claudeCount,
    } = debate;

    // Persist the transcript on the run as soon as the debate finishes, so it
    // is visible regardless of which terminal branch we take below.
    await upsertPrReviewRun({
      runId,
      owner: input.owner,
      repo: input.repo,
      prNumber: input.prNumber,
      prSha: pr.headSha,
      policy: policy as unknown as Record<string, unknown>,
      status: "started",
      debateRounds: debateTranscript,
    });

    // ---------- Step 4a: disputed -> disagreement adjudication panel ----------
    // Findings still raised by only ONE reviewer after the final round are
    // genuine, debated-out disagreements. Route them to the EXISTING
    // adjudication panel (disagreed terminal + disagreed_payload) unchanged.
    // We take this branch when there is NOTHING both reviewers agreed on but
    // there ARE one-sided findings — i.e. the debate failed to converge on
    // anything actionable. (If some findings agreed and some stayed disputed,
    // we proceed with the agreed set below; the disputed remnants are recorded
    // in the transcript for visibility.)
    if (agreedRaw.length === 0 && disputedRaw.length > 0) {
      const disagreedPayload = {
        codex: {
          summary: codexResult.summary ?? "",
          findings: codexResult.findings ?? [],
          rawResult: codexResult,
          jobId: codexJobId,
          errorText: codexErr,
        },
        claude: {
          summary: claudeResult.summary ?? "",
          findings: claudeResult.findings ?? [],
          rawResult: claudeResult,
          jobId: claudeJobId,
          errorText: claudeErr,
        },
        overlapRatio,
        capturedAt: new Date().toISOString(),
      };

      await audit("disagree-route", "info", {
        reason:
          "debate did not converge on any shared finding — routing to disagreed adjudication panel",
        codexCount,
        claudeCount,
        disputed: disputedRaw.length,
        overlapRatio,
        rounds: debateTranscript.rounds.length,
      });

      await upsertPrReviewRun({
        runId,
        owner: input.owner,
        repo: input.repo,
        prNumber: input.prNumber,
        prSha: pr.headSha,
        policy: policy as unknown as Record<string, unknown>,
        status: "disagreed",
        findingsCount: codexCount + claudeCount,
        disagreedPayload,
        debateRounds: debateTranscript,
      });

      await audit("complete", "ok", {
        status: "disagreed",
        codexCount,
        claudeCount,
        overlapRatio,
        commentPosted: false,
      });

      return {
        runId,
        status: "disagreed",
        findingsCount: codexCount + claudeCount,
        policy,
        agreement: "disagree",
        prSha: pr.headSha,
      };
    }

    // ---------- Step 4b: triage the AGREED set ----------
    const agreement: "agree" | "partial" | "disagree" =
      disputedRaw.length === 0 ? "agree" : "partial";
    const filteredBySeverity = dedupeFindings(agreedRaw).filter((f) =>
      severityAtLeast(f.severity, policy.severityThreshold)
    );
    await audit("triage", "ok", {
      agreed: agreedRaw.length,
      afterSeverityFilter: filteredBySeverity.length,
      threshold: policy.severityThreshold,
      stopReason: debateTranscript.stopReason,
    });

    if (filteredBySeverity.length === 0) {
      await audit("triage", "skip", {
        reason: "no agreed findings above threshold",
      });
      await upsertPrReviewRun({
        runId,
        owner: input.owner,
        repo: input.repo,
        prNumber: input.prNumber,
        prSha: pr.headSha,
        policy: policy as unknown as Record<string, unknown>,
        status: "skipped-no-findings",
        debateRounds: debateTranscript,
      });
      return {
        runId,
        status: "skipped-no-findings",
        findingsCount: 0,
        policy,
        agreement,
        prSha: pr.headSha,
      };
    }

    // ---------- Step 5: blast radius ----------
    await audit("blast-radius", "start");
    const touchedFiles = uniqStr(filteredBySeverity.map((f) => f.file));
    const blast = await getBlastRadiusForFiles(
      `${input.owner}/${input.repo}`,
      touchedFiles
    );
    await audit("blast-radius", "ok", {
      files: touchedFiles.length,
      available: blast.filter((b) => b.available).length,
    });

    let openPrsTouchingPaths: number[] = [];
    try {
      const list = await listOpenPRsTouchingPaths(
        input.owner,
        input.repo,
        touchedFiles
      );
      openPrsTouchingPaths = list.filter((n) => n !== input.prNumber);
    } catch {
      openPrsTouchingPaths = [];
    }

    // ---------- Step 6: approval gate ----------
    // Reviewers agreed AND findings remain above threshold. We do NOT post to
    // GitHub here and do NOT mark `completed`. Instead we persist the agreed
    // findings, create a Linear issue (REF) describing the PR + findings, and
    // park the run at `pending-approval` for Shaun to Approve/Reject from the
    // dashboard. The GitHub comment / fix work happens later (Slice 2) once
    // approval lands.
    await audit("approval-gate", "start", {
      findingsCount: filteredBySeverity.length,
    });

    const agreedFindings = filteredBySeverity.map((f) => ({
      file: f.file,
      line: f.line,
      severity: f.severity,
      category: f.category,
      message: f.message,
      suggestion: f.suggestion,
    }));

    // Best-effort blast-radius annotation onto the audit trail (already
    // computed above); the UI reads agreed findings from the run row.
    const blastTotalCallers = blast
      .filter((b) => b.available)
      .reduce((acc, b) => acc + b.callers.length, 0);

    // Create the Linear issue when the project routes to Linear. Never blocks
    // the gate — createPendingApprovalIssue returns null on any failure.
    let linearIssueUrl: string | undefined;
    let linearIssueId: string | undefined;
    let linearIssueIdentifier: string | undefined;
    if (
      !input.dryRun &&
      policy.issueTracker === "linear" &&
      policy.linearTeam
    ) {
      const issue = await createPendingApprovalIssue({
        teamKey: policy.linearTeam,
        owner: input.owner,
        repo: input.repo,
        prNumber: input.prNumber,
        prTitle: pr.title,
        prUrl: pr.url,
        prSha: pr.headSha,
        findings: agreedFindings.map((f) => ({
          severity: f.severity,
          file: f.file,
          line: f.line,
          message: f.message,
          suggestion: f.suggestion,
        })),
        runId,
      });
      if (issue) {
        linearIssueUrl = issue.url;
        linearIssueId = issue.id;
        linearIssueIdentifier = issue.identifier;
        await audit("linear-issue", "ok", {
          identifier: issue.identifier,
          url: issue.url,
        });
      } else {
        await audit("linear-issue", "error", {
          reason: "createPendingApprovalIssue returned null",
        });
      }
    } else if (input.dryRun) {
      await audit("linear-issue", "skip", { reason: "dryRun=true" });
    } else {
      await audit("linear-issue", "skip", {
        reason: `issueTracker=${policy.issueTracker}`,
      });
    }

    await upsertPrReviewRun({
      runId,
      owner: input.owner,
      repo: input.repo,
      prNumber: input.prNumber,
      prSha: pr.headSha,
      policy: policy as unknown as Record<string, unknown>,
      status: "pending-approval",
      findingsCount: filteredBySeverity.length,
      agreedFindings,
      debateRounds: debateTranscript,
      linearIssueId,
      linearIssueIdentifier,
      linearIssueUrl,
    });

    await audit("complete", "ok", {
      status: "pending-approval",
      findingsCount: filteredBySeverity.length,
      blastCallers: blastTotalCallers,
      openPrsTouchingPaths,
      linearIssueUrl: linearIssueUrl ?? null,
    });

    return {
      runId,
      status: "pending-approval",
      findingsCount: filteredBySeverity.length,
      linearIssueUrl,
      policy,
      agreement,
      prSha: pr.headSha,
    };
  } catch (err) {
    // Catch-all: surface the failure on the pr_review_runs row so we never
    // leave a row stuck at `started`. The workflow still re-throws so the
    // WDK marks the run as failed and retries semantics behave as expected.
    const message =
      err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    const truncated =
      message.length > 1000 ? `${message.slice(0, 1000)}...` : message;
    await audit("error", "error", { message: truncated });
    await upsertPrReviewRun({
      runId,
      owner: input.owner,
      repo: input.repo,
      prNumber: input.prNumber,
      status: "error",
      error: truncated,
    });
    throw err;
  }
}
