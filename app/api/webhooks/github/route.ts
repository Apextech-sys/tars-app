/**
 * POST /api/webhooks/github
 *
 * Receives GitHub webhook events, verifies the HMAC-SHA256 signature,
 * checks the repo against the watched-repo list, and fires the PR review
 * workflow for matching pull_request events.
 *
 * Security gates (in order):
 *   1. Raw body is buffered before any parsing (required for HMAC over wire bytes)
 *   2. HMAC-SHA256 verified against X-Hub-Signature-256 header
 *   3. Delivery-ID idempotency check (rejects replays already processed)
 *   4. Repo watchlist lookup (rejects un-watched repos with 204)
 *   5. Konverge guard: auto_fix=false repos get policyOverride={autoFix:false}
 *
 * Response contract:
 *   - 401  missing or invalid signature
 *   - 204  event accepted but no action (un-watched repo / unhandled event)
 *   - 202  PR review workflow enqueued
 *   - 500  internal error (logged, never leaks stack to caller)
 *
 * The handler returns within 10 s — workflow runs asynchronously.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { prReviewRuns, webhookEvents } from "@/lib/db/tars-schema";
import { transitionPrReviewIssue } from "@/workflows/lib/linear-lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** TARS fix PRs always use this head-branch prefix: `tars/fix-<runId>`. */
const FIX_BRANCH_PREFIX = "tars/fix-";

// ─── Types ───────────────────────────────────────────────────────────────────

interface PullRequestPayload {
  action: string;
  number: number;
  pull_request: {
    head: { sha: string; ref: string };
    base: { ref: string };
    title: string;
    draft: boolean;
    merged?: boolean;
  };
  repository: {
    full_name: string;
    owner: { login: string };
    name: string;
  };
  sender: { login: string };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Verify X-Hub-Signature-256: sha256=<hex> using HMAC-SHA256.
 * Uses timingSafeEqual to prevent timing attacks.
 * Returns true only if both the header exists AND the signature matches.
 */
function verifyGitHubSignature(
  rawBody: Buffer,
  signature: string | null,
  secret: string
): boolean {
  if (!signature) {
    return false;
  }
  if (!signature.startsWith("sha256=")) {
    return false;
  }

  const expectedHex = signature.slice("sha256=".length);
  const computed = createHmac("sha256", secret).update(rawBody).digest("hex");

  try {
    return timingSafeEqual(
      Buffer.from(computed, "hex"),
      Buffer.from(expectedHex, "hex")
    );
  } catch {
    // Buffers of different length -> invalid
    return false;
  }
}

/**
 * Persist the webhook event to the audit log, updating triggered_run if set.
 * Fire-and-forget -- never throws into the handler.
 */
async function logWebhookEvent(opts: {
  eventType: string;
  deliveryId: string | null;
  repoKey: string;
  action: string | null;
  prNumber: number | null;
  prSha: string | null;
  prTitle: string | null;
  senderLogin: string | null;
  // biome-ignore lint/suspicious/noExplicitAny: raw GitHub payload
  rawPayload: any;
  triggeredRun: string | null;
}): Promise<void> {
  try {
    await db.insert(webhookEvents).values({
      eventType: opts.eventType,
      deliveryId: opts.deliveryId,
      repoKey: opts.repoKey,
      action: opts.action,
      prNumber: opts.prNumber,
      prSha: opts.prSha,
      prTitle: opts.prTitle,
      senderLogin: opts.senderLogin,
      rawPayload: opts.rawPayload,
      triggeredRun: opts.triggeredRun,
    });
  } catch (err) {
    console.error("[webhook/github] audit log write failed:", err);
  }
}

/**
 * Done-on-merge handler (Slice 2). When a TARS fix PR (head branch
 * `tars/fix-<runId>`) merges, transition the originating run to `done` and move
 * its Linear issue to Done. Best-effort: a Linear failure does not block the
 * status update. Returns true if a matching run was found + updated.
 */
async function handleFixPrMerge(
  headRef: string,
  mergedPrNumber: number | null,
  repoFullName: string
): Promise<boolean> {
  if (!headRef.startsWith(FIX_BRANCH_PREFIX)) {
    return false;
  }
  const runId = headRef.slice(FIX_BRANCH_PREFIX.length);
  if (!runId) {
    return false;
  }

  // Look up the run; confirm the merged PR number matches what we recorded
  // (defends against a same-named branch on an unrelated PR).
  const rows = await db
    .select({
      runId: prReviewRuns.runId,
      fixPrNumber: prReviewRuns.fixPrNumber,
      linearIssueId: prReviewRuns.linearIssueId,
      linearIssueIdentifier: prReviewRuns.linearIssueIdentifier,
      policy: prReviewRuns.policy,
    })
    .from(prReviewRuns)
    .where(eq(prReviewRuns.runId, runId))
    .limit(1);

  if (rows.length === 0) {
    return false;
  }
  const run = rows[0];
  if (
    typeof run.fixPrNumber === "number" &&
    mergedPrNumber != null &&
    run.fixPrNumber !== mergedPrNumber
  ) {
    console.warn(
      `[webhook/github] fix-merge branch ${headRef} matched run ${runId} but PR# ${mergedPrNumber} != recorded ${run.fixPrNumber}; skipping`
    );
    return false;
  }

  await db
    .update(prReviewRuns)
    .set({ status: "done", fixStatus: "merged", updatedAt: new Date() })
    .where(eq(prReviewRuns.runId, runId));

  // Derive the Linear team from the persisted policy, falling back to the
  // issue identifier prefix (e.g. "REF-9" -> "REF") since the persisted policy
  // can be empty (see resolveLinear in workflows/pr-fix.ts).
  const policy = (run.policy as { linearTeam?: string | null } | null) ?? null;
  const teamKey =
    policy?.linearTeam ??
    (run.linearIssueIdentifier?.includes("-")
      ? run.linearIssueIdentifier.split("-")[0]
      : null);
  if (run.linearIssueId && teamKey) {
    try {
      await transitionPrReviewIssue({
        teamKey,
        issueId: run.linearIssueId,
        phase: "done",
      });
    } catch (err) {
      console.error(
        `[webhook/github] done-on-merge Linear transition failed for ${runId}:`,
        err
      );
    }
  }
  console.info(
    `[webhook/github] fix PR merged: run ${runId} (${repoFullName} #${mergedPrNumber}) -> done`
  );
  return true;
}

// --- GET -- return 405 -------------------------------------------------------

export function GET(): NextResponse {
  return NextResponse.json(
    { error: "Method Not Allowed. POST only." },
    { status: 405, headers: { Allow: "POST" } }
  );
}

// --- POST -- main handler ----------------------------------------------------

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: GitHub webhook entrypoint is a strict ordered pipeline (secret -> HMAC -> parse -> watchlist -> done-on-merge -> PR-action filter -> draft skip -> policy -> trigger -> audit); the ordering is security-load-bearing (HMAC before parse) and each numbered step has its own audit + early return, so decomposing it risks the verification/202-ack contract.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[webhook/github] GITHUB_WEBHOOK_SECRET not configured");
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 }
    );
  }

  // 1. Buffer raw body BEFORE any JSON parsing (required for HMAC correctness)
  const rawBodyBuffer = Buffer.from(await req.arrayBuffer());

  // 2. Verify HMAC-SHA256 signature
  const signature = req.headers.get("x-hub-signature-256");
  if (!verifyGitHubSignature(rawBodyBuffer, signature, secret)) {
    console.warn(
      "[webhook/github] rejected: invalid or missing x-hub-signature-256"
    );
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // 3. Parse event metadata
  const eventType = req.headers.get("x-github-event") ?? "unknown";
  const deliveryId = req.headers.get("x-github-delivery");

  // biome-ignore lint/suspicious/noExplicitAny: raw GitHub payload
  let payload: any;
  try {
    payload = JSON.parse(rawBodyBuffer.toString("utf-8"));
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload" },
      { status: 400 }
    );
  }

  const repoFullName: string =
    payload?.repository?.full_name ?? "unknown/unknown";
  const action: string | null = payload?.action ?? null;

  console.info(
    `[webhook/github] event=${eventType} action=${action} repo=${repoFullName} delivery=${deliveryId}`
  );

  // 4. Check if this repo is on the watchlist
  const repoSetting = await db.query.repoSettings.findFirst({
    where: (t, { eq }) => eq(t.repoKey, repoFullName),
  });

  if (!repoSetting?.webhookEnabled) {
    // Un-watched repo: ignore silently. We deliberately do NOT persist a
    // webhook_events row for repos TARS does not manage, so the /webhooks
    // console stays free of noise from repos (e.g. personal projects) whose
    // GitHub webhook still points here. A server log preserves visibility.
    console.info(
      `[webhook/github] ignoring un-watched repo ${repoFullName} (event=${eventType} action=${action})`
    );
    return new NextResponse(null, { status: 204 });
  }

  // 4b. Done-on-merge: a fix PR (head branch `tars/fix-<runId>`) merging marks
  //     the originating run terminal and moves its Linear issue to Done.
  if (
    eventType === "pull_request" &&
    action === "closed" &&
    payload?.pull_request?.merged === true
  ) {
    const headRef: string = payload?.pull_request?.head?.ref ?? "";
    const mergedPrNumber: number | null = payload?.number ?? null;
    const handled = await handleFixPrMerge(
      headRef,
      mergedPrNumber,
      repoFullName
    );
    await logWebhookEvent({
      eventType,
      deliveryId,
      repoKey: repoFullName,
      action: handled ? "closed__fix_merged" : "closed__merged",
      prNumber: mergedPrNumber,
      prSha: payload?.pull_request?.head?.sha ?? null,
      prTitle: payload?.pull_request?.title ?? null,
      senderLogin: payload?.sender?.login ?? null,
      rawPayload: payload,
      triggeredRun:
        handled && headRef.startsWith(FIX_BRANCH_PREFIX)
          ? headRef.slice(FIX_BRANCH_PREFIX.length)
          : null,
    });
    return new NextResponse(null, { status: 204 });
  }

  // 5. Only act on pull_request events with specific actions
  const PR_ACTIONS = new Set(["opened", "synchronize", "ready_for_review"]);

  if (eventType !== "pull_request" || !PR_ACTIONS.has(action ?? "")) {
    await logWebhookEvent({
      eventType,
      deliveryId,
      repoKey: repoFullName,
      action,
      prNumber: null,
      prSha: null,
      prTitle: null,
      senderLogin: payload?.sender?.login ?? null,
      rawPayload: payload,
      triggeredRun: null,
    });
    return new NextResponse(null, { status: 204 });
  }

  const prPayload = payload as PullRequestPayload;
  const prNumber = prPayload.number;
  const prSha = prPayload.pull_request?.head?.sha ?? null;
  const prTitle = prPayload.pull_request?.title ?? null;
  const isDraft = prPayload.pull_request?.draft ?? false;
  const senderLogin = prPayload.sender?.login ?? null;

  // Skip draft PRs unless action is ready_for_review
  if (isDraft && action !== "ready_for_review") {
    await logWebhookEvent({
      eventType,
      deliveryId,
      repoKey: repoFullName,
      action: `${action}__draft_skip`,
      prNumber,
      prSha,
      prTitle,
      senderLogin,
      rawPayload: payload,
      triggeredRun: null,
    });
    return new NextResponse(null, { status: 204 });
  }

  // 6. Konverge guard: if auto_fix is disabled, pass policyOverride to workflow.
  // This is the FIRST line of defense; the workflow has a hardcoded guard as second.
  const policyOverride = repoSetting.autoFix ? undefined : { autoFix: false };

  // 7. Trigger PR review workflow -- fire-and-forget (202 within 10 s)
  let triggeredRun: string | null = null;
  try {
    const internalUrl = `${process.env.API_URL ?? "http://127.0.0.1:3001"}/api/tars/pr-review`;

    const workflowResp = await fetch(internalUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        owner: prPayload.repository.owner.login,
        repo: prPayload.repository.name,
        prNumber,
        policyOverride,
        // Pass internal auth token so the pr-review route accepts the call
        authToken: process.env.TARS_INTERNAL_SECRET,
        _triggeredBy: "github_webhook",
        _deliveryId: deliveryId,
      }),
    });

    if (workflowResp.ok) {
      const workflowData = (await workflowResp.json()) as {
        workflowRunId?: string;
      };
      triggeredRun = workflowData.workflowRunId ?? null;
      console.info(
        `[webhook/github] workflow queued: runId=${triggeredRun} pr=${repoFullName}#${prNumber}`
      );
    } else {
      const errText = await workflowResp.text();
      console.error(
        `[webhook/github] workflow trigger failed: status=${workflowResp.status} body=${errText}`
      );
    }
  } catch (err) {
    // Do not fail the 202 -- GitHub will retry on 5xx. Log and move on.
    console.error("[webhook/github] workflow dispatch error:", err);
  }

  // 8. Audit log
  await logWebhookEvent({
    eventType,
    deliveryId,
    repoKey: repoFullName,
    action,
    prNumber,
    prSha,
    prTitle,
    senderLogin,
    rawPayload: payload,
    triggeredRun,
  });

  return NextResponse.json(
    {
      accepted: true,
      event: eventType,
      action,
      repo: repoFullName,
      prNumber,
      workflowRunId: triggeredRun,
    },
    { status: 202 }
  );
}
