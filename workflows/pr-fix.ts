/**
 * TARS PR Fix workflow (Slice 2 — stages 6–11).
 *
 * Started by the approval-action route the moment a run becomes `approved`.
 * Drives the FIX stage end-to-end:
 *
 *   - status `fixing`         : run loaded, Linear -> In Progress, fix job
 *                               dispatched to the worker.
 *   - the worker handler       : clone @ PR head, re-validate findings, blast
 *     (claude-fix-apply)        radius of the fix, fix within radius, run +
 *                               expand tests, root-cause the coverage gap,
 *                               commit to a NEW branch, push, OPEN a fix PR.
 *   - status `fix-in-review`   : fix PR opened -> Linear -> In Review + PR link
 *                               commented on the issue. Awaiting human review.
 *   - status `fix-failed`      : anything that prevents a clean fix PR (clone
 *                               fail, no reproducible finding, broken tests,
 *                               etc.) — recorded with a clear error, never a
 *                               silent hang or half-applied push.
 *
 * "Done on merge": when the fix PR merges, the GitHub webhook
 * (app/api/webhooks/github/route.ts, `closed` + merged) transitions the Linear
 * issue to Done and marks the run terminal. See that route for the hook.
 *
 * SAFETY: this workflow opens a PR; it NEVER merges and NEVER pushes to a
 * protected base branch. The worker handler enforces that in code.
 */

import {
  getRunForFix,
  type RunForFix,
  upsertFixResult,
  writeAudit,
} from "./lib/audit";
import { fetchPR } from "./lib/gh";
import {
  commentFixPrOnIssue,
  transitionFixPhase,
} from "./lib/linear-lifecycle";
import { dispatchJob, waitForJob } from "./lib/worker-dispatch";

export interface PRFixInput {
  runId: string;
}

export interface PRFixResult {
  runId: string;
  status: "fix-in-review" | "fix-failed";
  fixPrUrl?: string;
  fixPrNumber?: number;
  error?: string;
}

// The fix job clones + runs the agent + runs tests; give it room. The worker's
// own TARS_WORKER_JOB_TIMEOUT_MS (default 15m) is the hard ceiling per attempt;
// we poll a bit beyond that to absorb a single retry.
const FIX_POLL_TIMEOUT_MS = 35 * 60_000;

interface FixHandlerResult {
  outcome: "fix-in-review" | "fix-failed";
  fixBranch?: string;
  fixCommitSha?: string;
  fixPrUrl?: string;
  fixPrNumber?: number;
  revalidation?: Array<{
    finding: Record<string, unknown>;
    kept: boolean;
    reason: string;
  }>;
  blastRadius?: Record<string, unknown>;
  fixSummary?: string;
  testsAdded?: boolean;
  testExemptionReason?: string | null;
  testFiles?: string[];
  coverageRootCause?: string;
  existingTestsPassed?: boolean;
  testCommand?: string | null;
  filesChanged?: string[];
  shortstat?: string;
  error?: string;
}

export async function prFixWorkflow(input: PRFixInput): Promise<PRFixResult> {
  "use workflow";

  const runId = input.runId;

  // Load the approved run context.
  const run = await getRunForFix(runId);
  if (!run) {
    return { runId, status: "fix-failed", error: `run ${runId} not found` };
  }

  const audit: AuditFn = (step, status, data, message) =>
    writeAudit({
      runId,
      workflow: "pr-fix",
      step,
      status,
      owner: run.owner,
      repo: run.repo,
      prNumber: run.prNumber,
      message,
      data,
    });

  await audit("fix-start", "start", {
    findings: run.agreedFindings?.length ?? 0,
  });

  const precondition = await validatePreconditions(run, audit);
  if (precondition) {
    return precondition;
  }

  const linear = resolveLinear(run);

  try {
    // ── Enter `fixing`: persist status + Linear -> In Progress ───────────────
    await upsertFixResult({ runId, status: "fixing", fixStatus: "fixing" });
    await transitionLinear(linear, "fixing", "linear-fixing", audit);

    // PR metadata (base/head refs) — needed so the fix PR targets the right base.
    const pr = await fetchPR(run.owner, run.repo, run.prNumber);

    // ── Dispatch the fix job to the worker ───────────────────────────────────
    await audit("dispatch-fix", "start");
    const dispatch = await dispatchJob(
      "claude-fix-apply",
      buildFixJobPayload(run, pr),
      { idempotencyKey: `${runId}:claude-fix-apply`, maxAttempts: 1 }
    );
    await audit("dispatch-fix", "ok", { jobId: dispatch.jobId });

    // ── Wait for completion (waitForJob is a durable single step) ────────────
    const job = await waitForJob(dispatch.jobId, {
      timeoutMs: FIX_POLL_TIMEOUT_MS,
    }).catch(() => null);

    const failed = await checkJobFailure(runId, dispatch.jobId, job, audit);
    if (failed) {
      return failed;
    }

    // checkJobFailure guarantees job + result are present past this point.
    const result = (job as NonNullable<typeof job>).result as FixHandlerResult;
    await persistFixResult(runId, result, audit);

    if (result.outcome === "fix-failed") {
      return { runId, status: "fix-failed", error: result.error };
    }

    // ── fix-in-review: Linear -> In Review + comment the PR link ─────────────
    await announceInReview(linear, result, audit);

    await audit("fix-complete", "ok", {
      fixPrUrl: result.fixPrUrl,
      fixPrNumber: result.fixPrNumber,
    });

    return {
      runId,
      status: "fix-in-review",
      fixPrUrl: result.fixPrUrl,
      fixPrNumber: result.fixPrNumber,
    };
  } catch (err) {
    const message =
      err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    const truncated =
      message.length > 1000 ? `${message.slice(0, 1000)}...` : message;
    await audit("fix-error", "error", { message: truncated });
    await upsertFixResult({
      runId,
      status: "fix-failed",
      fixStatus: "workflow-error",
      error: truncated,
    });
    return { runId, status: "fix-failed", error: truncated };
  }
}

type LinearResolution =
  | { enabled: true; team: string; issueId: string }
  | { enabled: false; team: null; issueId: null };

/** Resolve whether (and how) to drive the Linear lifecycle for this run. */
function resolveLinear(run: RunForFix): LinearResolution {
  // A Linear issue already exists for this run iff `linearIssueId` is set —
  // that's the ground truth that the review stage created one. The persisted
  // policy can be `{}` (Slice 1 upserts the baseline row before the policy is
  // resolved, and its COALESCE never overwrites the empty object), so we must
  // NOT gate the fix-stage Linear lifecycle on the policy alone. Derive the
  // team from the policy when present, else from the issue identifier prefix
  // (e.g. "REF-9" -> team "REF").
  if (!run.linearIssueId) {
    return { enabled: false, team: null, issueId: null };
  }
  const policyTeam =
    run.policy && typeof run.policy.linearTeam === "string"
      ? run.policy.linearTeam
      : null;
  const identifierTeam = run.linearIssueIdentifier?.includes("-")
    ? run.linearIssueIdentifier.split("-")[0]
    : null;
  const team = policyTeam ?? identifierTeam;
  if (!team) {
    return { enabled: false, team: null, issueId: null };
  }
  return { enabled: true, team, issueId: run.linearIssueId };
}

/** Build the worker job payload for the fix handler (pure). */
function buildFixJobPayload(
  run: RunForFix,
  pr: {
    headSha: string;
    headRef: string;
    baseRef: string;
    url: string;
    title: string;
  }
): Record<string, unknown> {
  return {
    runId: run.runId,
    owner: run.owner,
    repo: run.repo,
    prNumber: run.prNumber,
    prSha: run.prSha ?? pr.headSha,
    prHeadRef: pr.headRef,
    prBaseRef: pr.baseRef,
    prUrl: pr.url,
    prTitle: pr.title,
    linearIssueIdentifier: run.linearIssueIdentifier ?? undefined,
    linearIssueUrl: run.linearIssueUrl ?? undefined,
    agreedFindings: run.agreedFindings,
  };
}

type AuditFn = (
  step: string,
  status: "start" | "ok" | "skip" | "error" | "info",
  data?: Record<string, unknown>,
  message?: string
) => Promise<void>;

/**
 * Guard the fix preconditions. Returns a terminal PRFixResult if the run can't
 * be fixed (not approved / no findings), or null to proceed.
 */
async function validatePreconditions(
  run: RunForFix,
  audit: AuditFn
): Promise<PRFixResult | null> {
  if (run.status !== "approved") {
    await audit("fix-start", "skip", { reason: `status=${run.status}` });
    return {
      runId: run.runId,
      status: "fix-failed",
      error: `run is "${run.status}", not "approved" — fix not started`,
    };
  }
  if (!run.agreedFindings || run.agreedFindings.length === 0) {
    await audit("fix-start", "skip", { reason: "no agreed findings" });
    await upsertFixResult({
      runId: run.runId,
      status: "fix-failed",
      fixStatus: "no-findings",
    });
    return {
      runId: run.runId,
      status: "fix-failed",
      error: "no agreed findings to fix",
    };
  }
  return null;
}

/** Transition the Linear issue to a phase (no-op when Linear disabled). */
async function transitionLinear(
  linear: LinearResolution,
  phase: "fixing" | "in-review",
  step: string,
  audit: AuditFn
): Promise<void> {
  if (!linear.enabled) {
    return;
  }
  const state = await transitionFixPhase({
    teamKey: linear.team,
    issueId: linear.issueId,
    phase,
  });
  await audit(step, state ? "ok" : "error", { state });
}

/** Persist the full work product on the run + audit the job outcome. */
async function persistFixResult(
  runId: string,
  result: FixHandlerResult,
  audit: AuditFn
): Promise<void> {
  await audit("fix-job", result.outcome === "fix-in-review" ? "ok" : "error", {
    outcome: result.outcome,
    filesChanged: result.filesChanged?.length ?? 0,
    keptFindings: result.revalidation?.filter((r) => r.kept).length ?? 0,
    testsAdded: result.testsAdded ?? false,
    error: result.error?.slice(0, 300),
  });
  await upsertFixResult({
    runId,
    status: result.outcome,
    fixStatus: result.outcome,
    fixBranch: result.fixBranch,
    fixPrUrl: result.fixPrUrl,
    fixPrNumber: result.fixPrNumber,
    fixRevalidation: result.revalidation,
    fixBlastRadius: result.blastRadius,
    fixCoverageRootcause: result.coverageRootCause,
    error: result.error,
  });
}

/** On a successful fix PR, move Linear to In Review + comment the PR link. */
async function announceInReview(
  linear: LinearResolution,
  result: FixHandlerResult,
  audit: AuditFn
): Promise<void> {
  if (!(linear.enabled && result.fixPrUrl)) {
    return;
  }
  const state = await transitionFixPhase({
    teamKey: linear.team,
    issueId: linear.issueId,
    phase: "in-review",
  });
  const commented = await commentFixPrOnIssue({
    issueId: linear.issueId,
    fixPrUrl: result.fixPrUrl,
    fixSummary: result.fixSummary,
    filesChanged: result.filesChanged,
    coverageRootCause: result.coverageRootCause,
  });
  await audit("linear-in-review", state ? "ok" : "error", { state, commented });
}

/**
 * Inspect the finished job. If it timed out or failed, persist `fix-failed`
 * and return the terminal PRFixResult; otherwise return null (job is done with
 * a result and the workflow continues).
 */
async function checkJobFailure(
  runId: string,
  jobId: string,
  job: Awaited<ReturnType<typeof waitForJob>> | null,
  audit: AuditFn
): Promise<PRFixResult | null> {
  if (!job) {
    await audit("fix-job", "error", { reason: "timeout" });
    await upsertFixResult({
      runId,
      status: "fix-failed",
      fixStatus: "timeout",
    });
    return {
      runId,
      status: "fix-failed",
      error: `fix job ${jobId} timed out after ${FIX_POLL_TIMEOUT_MS}ms`,
    };
  }
  if (job.status !== "done" || !job.result) {
    await audit("fix-job", "error", {
      status: job.status,
      errorText: job.errorText?.slice(0, 300),
    });
    await upsertFixResult({
      runId,
      status: "fix-failed",
      fixStatus: "job-failed",
    });
    return {
      runId,
      status: "fix-failed",
      error: job.errorText ?? `fix job ${job.status}`,
    };
  }
  return null;
}
