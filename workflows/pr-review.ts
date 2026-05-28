/**
 * TARS PR Review workflow (M4).
 *
 * Pipeline (against M3's actual worker API):
 *   1. routing          — resolve policy from projects.yaml
 *   2. fetch-pr         — pull PR metadata + diff
 *   3. parallel dual review:
 *      a. codex-review   — dispatch to tars-worker (kind="codex-review")
 *      b. claude-review  — dispatch to tars-worker (kind="claude-review")
 *      Both run independently. We wait for both, then compute agreement
 *      by finding overlap (same file & nearby line, OR same title).
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

function computeAgreement(
  codexFindings: Finding[],
  claudeFindings: Finding[]
): "agree" | "partial" | "disagree" {
  if (codexFindings.length === 0 && claudeFindings.length === 0) {
    return "agree";
  }
  if (codexFindings.length === 0 || claudeFindings.length === 0) {
    return "disagree";
  }
  const overlapRatio = computeOverlapRatio(codexFindings, claudeFindings);
  if (overlapRatio >= 0.5) {
    return "agree";
  }
  if (overlapRatio >= 0.2) {
    return "partial";
  }
  return "disagree";
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
      policy: policy as unknown as Record<string, unknown>,
      status: "started",
    });

    // ---------- Step 3: parallel codex-review + claude-review ----------
    await audit("dispatch-reviews", "start");
    const reviewPayload = {
      diff: prDiff,
      repo: `${input.owner}/${input.repo}`,
      prNumber: input.prNumber,
      context: `Title: ${pr.title}\n\n${pr.body}`,
    };
    const codexDispatch = await dispatchJob("codex-review", reviewPayload, {
      idempotencyKey: `${runId}:codex-review`,
      maxAttempts: 2,
    });
    const claudeDispatch = await dispatchJob("claude-review", reviewPayload, {
      idempotencyKey: `${runId}:claude-review`,
      maxAttempts: 2,
    });
    await audit("dispatch-reviews", "ok", {
      codexJobId: codexDispatch.jobId,
      claudeJobId: claudeDispatch.jobId,
    });

    await audit("codex-review", "start", { jobId: codexDispatch.jobId });
    const codexJob = await waitForJob(codexDispatch.jobId, {
      timeoutMs: WORKER_TIMEOUT_MS,
    });
    await audit("codex-review", codexJob.status === "done" ? "ok" : "error", {
      status: codexJob.status,
      attempts: codexJob.attempts,
      errorText: codexJob.errorText?.slice(0, 200),
    });

    await audit("claude-review", "start", { jobId: claudeDispatch.jobId });
    const claudeJob = await waitForJob(claudeDispatch.jobId, {
      timeoutMs: WORKER_TIMEOUT_MS,
    });
    await audit("claude-review", claudeJob.status === "done" ? "ok" : "error", {
      status: claudeJob.status,
      attempts: claudeJob.attempts,
      errorText: claudeJob.errorText?.slice(0, 200),
    });

    // Parse results, fall back to empty review on failure.
    const codexResult: M3ReviewResult =
      codexJob.status === "done" && codexJob.result
        ? (codexJob.result as M3ReviewResult)
        : {
            summary: codexJob.errorText ?? "codex review unavailable",
            findings: [],
          };
    const claudeResult: M3ReviewResult =
      claudeJob.status === "done" && claudeJob.result
        ? (claudeJob.result as M3ReviewResult)
        : {
            summary: claudeJob.errorText ?? "claude review unavailable",
            findings: [],
          };

    const codexFindings = m3ToTarsFindings(codexResult);
    const claudeFindings = m3ToTarsFindings(claudeResult);

    // ---------- Step 4: agreement + triage ----------
    const agreement = computeAgreement(codexFindings, claudeFindings);
    const overlapRatio = computeOverlapRatio(codexFindings, claudeFindings);
    await audit("agreement", "ok", {
      agreement,
      codex: codexFindings.length,
      claude: claudeFindings.length,
      overlapRatio,
    });

    // ---------- Step 4a: disagree gate ----------
    // When Codex and Claude disagree AND at least one of them flagged something,
    // we do NOT post a public PR comment. The two raw outputs are preserved on
    // the pr_review_runs row for Shaun to adjudicate from /inbox. This path is
    // unchanged by Slice 1 and runs for all repos (incl. Konverge/REF) now that
    // protect_mode is retired.
    if (
      agreement === "disagree" &&
      codexFindings.length + claudeFindings.length > 0
    ) {
      const disagreedPayload = {
        codex: {
          summary: codexResult.summary ?? "",
          findings: codexResult.findings ?? [],
          rawResult: codexResult,
          jobId: codexDispatch.jobId,
          errorText: codexJob.errorText ?? null,
        },
        claude: {
          summary: claudeResult.summary ?? "",
          findings: claudeResult.findings ?? [],
          rawResult: claudeResult,
          jobId: claudeDispatch.jobId,
          errorText: claudeJob.errorText ?? null,
        },
        overlapRatio,
        capturedAt: new Date().toISOString(),
      };

      await audit("disagree-route", "info", {
        reason:
          "codex/claude disagreement — routing to disagreed terminal without posting",
        codexCount: codexFindings.length,
        claudeCount: claudeFindings.length,
        overlapRatio,
      });

      await upsertPrReviewRun({
        runId,
        owner: input.owner,
        repo: input.repo,
        prNumber: input.prNumber,
        prSha: pr.headSha,
        policy: policy as unknown as Record<string, unknown>,
        status: "disagreed",
        findingsCount: codexFindings.length + claudeFindings.length,
        disagreedPayload,
      });

      await audit("complete", "ok", {
        status: "disagreed",
        codexCount: codexFindings.length,
        claudeCount: claudeFindings.length,
        overlapRatio,
        commentPosted: false,
      });

      return {
        runId,
        status: "disagreed",
        findingsCount: codexFindings.length + claudeFindings.length,
        policy,
        agreement,
        prSha: pr.headSha,
      };
    }

    const merged = dedupeFindings([...codexFindings, ...claudeFindings]);
    const filteredBySeverity = merged.filter((f) =>
      severityAtLeast(f.severity, policy.severityThreshold)
    );
    await audit("triage", "ok", {
      merged: merged.length,
      afterSeverityFilter: filteredBySeverity.length,
      threshold: policy.severityThreshold,
    });

    if (filteredBySeverity.length === 0) {
      await audit("triage", "skip", { reason: "no findings above threshold" });
      await upsertPrReviewRun({
        runId,
        owner: input.owner,
        repo: input.repo,
        prNumber: input.prNumber,
        prSha: pr.headSha,
        policy: policy as unknown as Record<string, unknown>,
        status: "skipped-no-findings",
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
