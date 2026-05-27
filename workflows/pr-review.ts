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
 *   6. dispatch         — post PR comment / Slack
 *
 * Konverge protect mode (assertWriteAllowed) gates every write op.
 *
 * Worker dispatch uses M3's UUID-based job rows + polling via waitForJob.
 */

import { renderFindingMarkdown } from "@/lib/pr-review/renderer";
import { upsertPrReviewRun, writeAudit } from "./lib/audit";
import {
  fetchPR,
  fetchPRDiff,
  fetchPRFiles,
  listOpenPRsTouchingPaths,
  postPRComment,
} from "./lib/gh";
import { getBlastRadiusForFiles } from "./lib/graph-client";
import { assertWriteAllowed, canWrite } from "./lib/konverge-guard";
import {
  type ResolvedPolicy,
  resolvePolicy,
  severityAtLeast,
} from "./lib/policy";
import type { Finding, Severity } from "./lib/schemas";
import { postSlackMessage } from "./lib/slack";
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
    | "completed"
    | "skipped-disagreement"
    | "skipped-no-findings"
    | "skipped-policy"
    | "blocked-konverge"
    | "disagreed"
    | "error";
  findingsCount: number;
  reviewCommentUrl?: string;
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

function formatReviewBody(args: {
  prSha: string;
  prUrl: string;
  policy: ResolvedPolicy;
  findings: Finding[];
  blast: { available: boolean; callers: string[] }[];
  openPrsTouchingPaths: number[];
  agreement: "agree" | "partial" | "disagree";
  codexSummary: string;
  claudeSummary: string;
  codexCount: number;
  claudeCount: number;
}): string {
  const lines: string[] = [];
  lines.push("## TARS PR Review");
  lines.push("");
  lines.push(
    `**Agreement:** ${args.agreement}  |  **Policy:** \`${args.policy.projectKey ?? "default"}\`  |  **HEAD:** \`${args.prSha.slice(0, 7)}\``
  );
  lines.push(
    `Codex flagged ${args.codexCount}, Claude flagged ${args.claudeCount}. Merged + filtered to ${args.findings.length}.`
  );
  lines.push("");

  if (args.findings.length === 0) {
    lines.push("_No findings above severity threshold._");
  } else {
    lines.push(
      `### ${args.findings.length} finding${args.findings.length === 1 ? "" : "s"}`
    );
    lines.push("");
    for (const f of args.findings) {
      // Centralised renderer — keeps byte-identical output across the agree
      // path (here) and the manual-adjudication route in
      // app/api/tars/pr-review/disagreement-action/route.ts.
      lines.push(renderFindingMarkdown(f));
    }
  }

  if (args.openPrsTouchingPaths.length > 0) {
    lines.push("");
    lines.push(
      `**Other open PRs touching these paths:** ${args.openPrsTouchingPaths
        .map((n) => `#${n}`)
        .join(", ")}`
    );
  }

  const blastAvailable = args.blast.filter((b) => b.available);
  if (blastAvailable.length > 0) {
    const totalCallers = blastAvailable.reduce(
      (acc, b) => acc + b.callers.length,
      0
    );
    if (totalCallers > 0) {
      lines.push("");
      lines.push(
        `**Blast radius (from TARS graph):** ${totalCallers} caller${totalCallers === 1 ? "" : "s"} across ${blastAvailable.length} touched file${blastAvailable.length === 1 ? "" : "s"}.`
      );
    }
  }

  if (args.codexSummary || args.claudeSummary) {
    lines.push("");
    lines.push("<details><summary>Reviewer summaries</summary>");
    lines.push("");
    if (args.codexSummary) {
      lines.push(`**Codex:** ${args.codexSummary}`);
      lines.push("");
    }
    if (args.claudeSummary) {
      lines.push(`**Claude:** ${args.claudeSummary}`);
    }
    lines.push("");
    lines.push("</details>");
  }

  lines.push("");
  lines.push(
    "<sub>Generated by TARS PR Review workflow. This is an automated review — confirm findings before acting.</sub>"
  );
  return lines.join("\n");
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

    if (policy.protectMode) {
      await audit("routing", "skip", { reason: "konverge-protect-mode" });
      await upsertPrReviewRun({
        runId,
        owner: input.owner,
        repo: input.repo,
        prNumber: input.prNumber,
        policy: policy as unknown as Record<string, unknown>,
        status: "blocked-konverge",
      });
      return { runId, status: "blocked-konverge", findingsCount: 0, policy };
    }

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
    // the pr_review_runs row for Shaun to adjudicate from /inbox.
    //
    // The Konverge protect-mode short-circuit runs in Step 1, so this branch
    // is never reached for protected repos — they're already terminated as
    // `blocked-konverge`.
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

    // ---------- Step 6: dispatch ----------
    await audit("dispatch", "start");
    const body = formatReviewBody({
      prSha: pr.headSha,
      prUrl: pr.url,
      policy,
      findings: filteredBySeverity,
      blast,
      openPrsTouchingPaths,
      agreement,
      codexSummary: codexResult.summary ?? "",
      claudeSummary: claudeResult.summary ?? "",
      codexCount: codexFindings.length,
      claudeCount: claudeFindings.length,
    });

    let reviewCommentUrl: string | undefined;
    if (input.dryRun) {
      await audit("dispatch", "skip", { reason: "dryRun=true" });
    } else if (canWrite(policy, "pr-comment")) {
      assertWriteAllowed(policy, "pr-comment");
      const posted = await postPRComment(
        input.owner,
        input.repo,
        input.prNumber,
        body
      );
      reviewCommentUrl = posted.url;
      await audit("dispatch", "ok", { reviewCommentUrl, commentId: posted.id });
    } else {
      await audit("dispatch", "skip", { reason: "policy disallows write" });
    }

    if (
      policy.slackNotify &&
      policy.slackChannel &&
      !input.dryRun &&
      canWrite(policy, "slack-post")
    ) {
      assertWriteAllowed(policy, "slack-post");
      const slackResp = await postSlackMessage({
        channel: policy.slackChannel,
        text: `TARS reviewed ${pr.url} — ${filteredBySeverity.length} findings (${agreement}).`,
      });
      await audit("dispatch", slackResp.ok ? "ok" : "error", {
        slack: slackResp,
      });
    }

    await upsertPrReviewRun({
      runId,
      owner: input.owner,
      repo: input.repo,
      prNumber: input.prNumber,
      prSha: pr.headSha,
      policy: policy as unknown as Record<string, unknown>,
      status: "completed",
      findingsCount: filteredBySeverity.length,
      reviewCommentUrl,
    });

    await audit("complete", "ok", {
      findingsCount: filteredBySeverity.length,
      reviewCommentUrl,
    });

    return {
      runId,
      status: "completed",
      findingsCount: filteredBySeverity.length,
      reviewCommentUrl,
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
