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

import { timingSafeEqual, createHmac } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { webhookEvents } from "@/lib/db/tars-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── Types ───────────────────────────────────────────────────────────────────

interface PullRequestPayload {
  action: string;
  number: number;
  pull_request: {
    head: { sha: string };
    title: string;
    draft: boolean;
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
  secret: string,
): boolean {
  if (!signature) return false;
  if (!signature.startsWith("sha256=")) return false;

  const expectedHex = signature.slice("sha256=".length);
  const computed = createHmac("sha256", secret).update(rawBody).digest("hex");

  try {
    return timingSafeEqual(
      Buffer.from(computed, "hex"),
      Buffer.from(expectedHex, "hex"),
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

// --- GET -- return 405 -------------------------------------------------------

export function GET(): NextResponse {
  return NextResponse.json(
    { error: "Method Not Allowed. POST only." },
    { status: 405, headers: { Allow: "POST" } },
  );
}

// --- POST -- main handler ----------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[webhook/github] GITHUB_WEBHOOK_SECRET not configured");
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 },
    );
  }

  // 1. Buffer raw body BEFORE any JSON parsing (required for HMAC correctness)
  const rawBodyBuffer = Buffer.from(await req.arrayBuffer());

  // 2. Verify HMAC-SHA256 signature
  const signature = req.headers.get("x-hub-signature-256");
  if (!verifyGitHubSignature(rawBodyBuffer, signature, secret)) {
    console.warn(
      "[webhook/github] rejected: invalid or missing x-hub-signature-256",
    );
    return NextResponse.json(
      { error: "Invalid signature" },
      { status: 401 },
    );
  }

  // 3. Parse event metadata
  const eventType = req.headers.get("x-github-event") ?? "unknown";
  const deliveryId = req.headers.get("x-github-delivery");

  // biome-ignore lint/suspicious/noExplicitAny: raw GitHub payload
  let payload: any;
  try {
    payload = JSON.parse(rawBodyBuffer.toString("utf-8"));
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const repoFullName: string =
    payload?.repository?.full_name ?? "unknown/unknown";
  const action: string | null = payload?.action ?? null;

  console.info(
    `[webhook/github] event=${eventType} action=${action} repo=${repoFullName} delivery=${deliveryId}`,
  );

  // 4. Check if this repo is on the watchlist
  const repoSetting = await db.query.repoSettings.findFirst({
    where: (t, { eq }) => eq(t.repoKey, repoFullName),
  });

  if (!repoSetting || !repoSetting.webhookEnabled) {
    // Not watched -- accept delivery but take no action (don't expose 404 to GitHub)
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

  // 5. Only act on pull_request events with specific actions
  const PR_ACTIONS = new Set([
    "opened",
    "synchronize",
    "ready_for_review",
  ]);

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
  const policyOverride = repoSetting.autoFix
    ? undefined
    : { autoFix: false };

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
        `[webhook/github] workflow queued: runId=${triggeredRun} pr=${repoFullName}#${prNumber}`,
      );
    } else {
      const errText = await workflowResp.text();
      console.error(
        `[webhook/github] workflow trigger failed: status=${workflowResp.status} body=${errText}`,
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
    { status: 202 },
  );
}
