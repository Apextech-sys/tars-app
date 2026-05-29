/**
 * POST /api/tars/pr-review/approval-action
 *
 * Closes the human approval gate on a `pending-approval` PR-review run.
 *
 *   - "approve"  -> status `approved`. Transitions the linked Linear issue to
 *                   "In Progress" and records that the fix stage is authorized
 *                   (Slice 2 will consume `approval_action = 'approve'`).
 *   - "reject"   -> status `rejected`. Transitions the Linear issue to
 *                   "Canceled". An optional `reason` is persisted.
 *
 * Auth: this is a Shaun-only action reachable only over the Tailscale-private
 * dashboard origin (same trust model as the disagreement-action route, which
 * has no token gate). To ALSO allow secret-bearing programmatic callers, if a
 * non-empty `authToken` is supplied in the body it MUST match
 * TARS_INTERNAL_SECRET (timing-safe). Same-origin dashboard calls omit the
 * token and are allowed — we never expose the secret to the browser.
 *
 * Idempotency: if `approval_action` is already set the route returns 409 and
 * does NOT re-transition Linear. The Linear transition is best-effort: a
 * Linear API failure is recorded on the audit log but does NOT block the
 * status change (the approval decision is the source of truth; Linear is a
 * downstream mirror that a retry/sweep can reconcile).
 */

import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { start } from "workflow/api";
import { z } from "zod";
import { timingSafeAuthTokenEqual } from "@/lib/auth/internal-secret";
import { db } from "@/lib/db";
import { auditLog, prReviewRuns } from "@/lib/db/tars-schema";
import { transitionPrReviewIssue } from "@/workflows/lib/linear-lifecycle";
import { prFixWorkflow } from "@/workflows/pr-fix";

export const runtime = "nodejs";

const bodySchema = z.object({
  runId: z.string().min(1),
  action: z.enum(["approve", "reject"]),
  reason: z.string().max(2000).optional(),
  authToken: z.string().optional(),
});

interface PolicyShape {
  issueTracker?: "linear" | "github" | "none";
  linearTeam?: string | null;
}

async function writeAuditRow(args: {
  runId: string;
  owner: string;
  repo: string;
  prNumber: number;
  status: "ok" | "error";
  message?: string;
  data: Record<string, unknown>;
}): Promise<void> {
  await db.insert(auditLog).values({
    runId: args.runId,
    workflow: "pr-review",
    step: "approval-action",
    status: args.status,
    owner: args.owner,
    repo: args.repo,
    prNumber: args.prNumber,
    message: args.message ?? null,
    data: args.data,
  });
}

interface LinearTransitionResult {
  ok: boolean;
  stateName?: string;
  error?: string;
}

/** Best-effort Linear transition; never throws. */
async function tryTransitionLinear(args: {
  policy: PolicyShape | null;
  linearIssueId: string | null;
  action: "approve" | "reject";
}): Promise<LinearTransitionResult> {
  const { policy, linearIssueId, action } = args;
  if (
    !(linearIssueId && policy?.issueTracker === "linear" && policy.linearTeam)
  ) {
    return { ok: false };
  }
  try {
    return await transitionPrReviewIssue({
      teamKey: policy.linearTeam,
      issueId: linearIssueId,
      phase: action === "approve" ? "approved" : "rejected",
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function linearAuditSuffix(t: LinearTransitionResult): string {
  if (t.ok) {
    return ` (Linear: ${t.stateName})`;
  }
  if (t.error) {
    return ` (Linear failed: ${t.error.slice(0, 200)})`;
  }
  return "";
}

interface FixStartResult {
  fixWorkflowRunId: string | null;
  fixStartError?: string;
}

/**
 * On approve, start the Slice 2 fix workflow. `start()` enqueues the durable
 * workflow and returns immediately — the approval HTTP response is never
 * blocked on the fix work. A start failure is recorded but never fails the
 * approval (the decision is already persisted; a sweep can retry).
 */
async function startFixStage(
  action: "approve" | "reject",
  runId: string
): Promise<FixStartResult> {
  if (action !== "approve") {
    return { fixWorkflowRunId: null };
  }
  try {
    const fixRun = await start(prFixWorkflow, [{ runId }]);
    return { fixWorkflowRunId: fixRun.runId ?? null };
  } catch (err) {
    return {
      fixWorkflowRunId: null,
      fixStartError: err instanceof Error ? err.message : String(err),
    };
  }
}

function fixAuditSuffix(
  action: "approve" | "reject",
  fix: FixStartResult
): string {
  if (action !== "approve") {
    return "";
  }
  if (fix.fixStartError) {
    return ` (fix start FAILED: ${fix.fixStartError.slice(0, 150)})`;
  }
  return " (fix stage started)";
}

export async function POST(req: NextRequest) {
  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", issues: err.issues },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "Malformed body" }, { status: 400 });
  }

  // If a token is supplied (programmatic caller), it must match the internal
  // secret. Same-origin dashboard calls omit it and rely on the Tailscale-only
  // network boundary (identical trust model to disagreement-action).
  const expected = process.env.TARS_INTERNAL_SECRET;
  if (
    parsed.authToken &&
    expected &&
    !timingSafeAuthTokenEqual(parsed.authToken, expected)
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { runId, action, reason } = parsed;

  const rows = await db
    .select({
      runId: prReviewRuns.runId,
      owner: prReviewRuns.owner,
      repo: prReviewRuns.repo,
      prNumber: prReviewRuns.prNumber,
      status: prReviewRuns.status,
      policy: prReviewRuns.policy,
      approvalAction: prReviewRuns.approvalAction,
      linearIssueId: prReviewRuns.linearIssueId,
      linearIssueIdentifier: prReviewRuns.linearIssueIdentifier,
    })
    .from(prReviewRuns)
    .where(eq(prReviewRuns.runId, runId))
    .limit(1);

  if (rows.length === 0) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const run = rows[0];

  if (run.status !== "pending-approval") {
    return NextResponse.json(
      { error: `Run is in state "${run.status}", not "pending-approval"` },
      { status: 409 }
    );
  }

  if (run.approvalAction) {
    return NextResponse.json(
      {
        error: `Run is already actioned as "${run.approvalAction}"`,
        approvalAction: run.approvalAction,
      },
      { status: 409 }
    );
  }

  const newStatus = action === "approve" ? "approved" : "rejected";

  // Persist the decision FIRST — it's the source of truth. Linear transition
  // is best-effort downstream.
  await db
    .update(prReviewRuns)
    .set({
      status: newStatus,
      approvalAction: action,
      approvalActionAt: new Date(),
      approvalReason: reason ?? null,
      updatedAt: new Date(),
    })
    .where(eq(prReviewRuns.runId, runId));

  // Best-effort Linear transition (extracted to keep POST simple).
  const policy = (run.policy as PolicyShape | null) ?? null;
  const linearTransition = await tryTransitionLinear({
    policy,
    linearIssueId: run.linearIssueId,
    action,
  });

  // On approve, kick off the FIX stage (Slice 2) — non-blocking.
  const fix = await startFixStage(action, runId);

  await writeAuditRow({
    runId,
    owner: run.owner,
    repo: run.repo,
    prNumber: run.prNumber,
    status: linearTransition.error || fix.fixStartError ? "error" : "ok",
    message: `${action} -> ${newStatus}${linearAuditSuffix(linearTransition)}${fixAuditSuffix(action, fix)}`,
    data: {
      action,
      newStatus,
      reason: reason ?? null,
      linearIssueIdentifier: run.linearIssueIdentifier,
      linearTransition,
      fixWorkflowRunId: fix.fixWorkflowRunId,
      fixStartError: fix.fixStartError ?? null,
      actionedBy: "shaun",
    },
  });

  return NextResponse.json({
    ok: true,
    runId,
    action,
    status: newStatus,
    linear: linearTransition,
    fixWorkflowRunId: fix.fixWorkflowRunId,
  });
}
