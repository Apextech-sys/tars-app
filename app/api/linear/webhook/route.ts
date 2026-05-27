/**
 * Linear webhook receiver.
 *
 *   POST /api/linear/webhook
 *
 * Verifies the Linear-Signature HMAC-SHA256 over the raw body (with
 * LINEAR_WEBHOOK_SECRET). Handles Comment.create events where the body
 * starts with `@tars` or mentions the linear bot user.
 *
 * Flow:
 *   1. Verify signature.
 *   2. Filter for Comment.create payloads.
 *   3. Check the comment body for @tars trigger.
 *   4. Look up the parent issue (title, description, project, team).
 *   5. Look up project metadata via projects.yaml — respect personal/work
 *      firewall (personal Linear context never bleeds elsewhere).
 *   6. Route through runChatTurn with the issue context threaded in.
 *   7. Post the response as a new comment on the same issue.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { randomUUID } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { writeAdapterAudit } from "@/lib/tars/adapter-audit";
import { getAppSetting, setAppSetting } from "@/lib/tars/app-settings";
import { runChatTurn } from "@/lib/tars/chat-runner";
import {
  fetchLinearIssueContext,
  loadProjectsByLinearTeam,
  postLinearComment,
  verifyLinearSignature,
} from "@/lib/tars/linear";
import { mapLinearUserToTars } from "@/lib/tars/user-mapper";

interface LinearWebhookPayload {
  action: "create" | "update" | "remove";
  type: string;
  createdAt: string;
  data: {
    id: string;
    body?: string;
    issueId?: string;
    userId?: string;
    user?: { id: string; name?: string; email?: string };
    issue?: { id: string; identifier?: string; team?: { key?: string } };
  };
  organizationId?: string;
  webhookId?: string;
  webhookTimestamp?: number;
}

const TARS_TRIGGER_RE = /(^|\s)@tars(\b|\s|:|,)/i;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const webhookSecret = process.env.LINEAR_WEBHOOK_SECRET;
  const apiKey = process.env.LINEAR_API_KEY;
  if (!(webhookSecret && apiKey)) {
    await writeAdapterAudit({
      runId: randomUUID(),
      workflow: "linear-adapter",
      step: "config",
      status: "error",
      message: "LINEAR_WEBHOOK_SECRET or LINEAR_API_KEY missing",
    });
    return NextResponse.json(
      { error: "linear adapter not configured" },
      { status: 500 }
    );
  }

  const rawBody = await req.text();
  const sig = req.headers.get("linear-signature");

  if (
    !verifyLinearSignature({
      webhookSecret,
      signatureHeader: sig,
      rawBody,
    })
  ) {
    await writeAdapterAudit({
      runId: randomUUID(),
      workflow: "linear-adapter",
      step: "verify-signature",
      status: "error",
      message: "invalid signature",
      data: { hasSig: Boolean(sig) },
    });
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: LinearWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as LinearWebhookPayload;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const runId = payload.webhookId ?? randomUUID();

  if (payload.type !== "Comment" || payload.action !== "create") {
    return NextResponse.json({
      ok: true,
      ignored: `${payload.type}:${payload.action}`,
    });
  }

  const commentBody = (payload.data.body ?? "").trim();
  if (!commentBody) {
    return NextResponse.json({ ok: true, ignored: "empty-body" });
  }

  const cachedLinearBotUserId =
    await getAppSetting<string>("linear_bot_user_id");

  // Cache the bot user id if we can derive it (when a comment is posted by us
  // — outbound — we'd see it via subscription; here we just persist the first
  // time we see a `viewer` id via the projects yaml if configured).
  // Triggering rules:
  //   * comment text begins with or contains '@tars'
  //   * OR comment author equals linear_bot_user_id (skip — that's ourselves)
  const authorUserId =
    payload.data.user?.id ?? payload.data.userId ?? undefined;
  if (cachedLinearBotUserId && authorUserId === cachedLinearBotUserId) {
    return NextResponse.json({ ok: true, ignored: "self-comment" });
  }

  const isTriggered =
    TARS_TRIGGER_RE.test(commentBody) ||
    (cachedLinearBotUserId && commentBody.includes(cachedLinearBotUserId));
  if (!isTriggered) {
    return NextResponse.json({ ok: true, ignored: "no-trigger" });
  }

  const issueId = payload.data.issueId ?? payload.data.issue?.id;
  if (!issueId) {
    await writeAdapterAudit({
      runId,
      workflow: "linear-adapter",
      step: "validate",
      status: "skip",
      message: "comment without issueId",
    });
    return NextResponse.json({ ok: true, ignored: "no-issue" });
  }

  await writeAdapterAudit({
    runId,
    workflow: "linear-adapter",
    step: "inbound",
    status: "start",
    data: { issueId, authorUserId, commentLen: commentBody.length },
  });

  // Background the heavy work — Linear retries on non-2xx; we ack fast.
  // The IIFE catches its own errors internally; the outer .catch() exists
  // only to satisfy lint (every promise must be observed).
  (async () => {
    try {
      const issueCtx = await fetchLinearIssueContext({
        apiKey,
        issueId,
      });
      if (!issueCtx) {
        await writeAdapterAudit({
          runId,
          workflow: "linear-adapter",
          step: "issue-fetch",
          status: "error",
          message: "issue context not found",
          data: { issueId },
        });
        return;
      }

      // Persona/visibility firewall: load project mapping and refuse to leak
      // personal context. We still respond — but skip threading any work
      // context if visibility=personal AND the comment came from a non-shaun
      // identity. Since we can't tell "is this Shaun" without a Linear→tars
      // user map yet, we apply the conservative rule: personal projects get
      // only the bare issue title/desc + comment, never cross-project notes.
      const projectMap = await loadProjectsByLinearTeam();
      const projectMeta = projectMap.get(issueCtx.teamKey);
      const visibility = projectMeta?.visibility ?? "work";
      const protectMode = projectMeta?.protectMode ?? false;

      // Stamp the bot user id once if we have a way to derive it. Linear
      // payloads don't include "viewer" by default; we leave this for a
      // future bootstrap script.
      if (!cachedLinearBotUserId && process.env.LINEAR_BOT_USER_ID) {
        await setAppSetting(
          "linear_bot_user_id",
          process.env.LINEAR_BOT_USER_ID
        );
      }

      const tarsUserId = await mapLinearUserToTars(
        authorUserId ?? "unknown",
        payload.data.user?.name
      );

      const contextLines = [
        `(Inbound via Linear comment on issue ${issueCtx.identifier}.)`,
        `Issue title: ${issueCtx.title}`,
      ];
      if (issueCtx.description) {
        contextLines.push(
          `Issue description (truncated): ${issueCtx.description.slice(0, 800)}`
        );
      }
      if (issueCtx.projectName) {
        contextLines.push(`Project: ${issueCtx.projectName}`);
      }
      contextLines.push(`Team: ${issueCtx.teamKey}`);
      if (visibility === "personal") {
        contextLines.push(
          "[firewall] This issue is on a PERSONAL project — do not share context with other workspaces; treat this as a private conversation."
        );
      }
      if (protectMode) {
        contextLines.push(
          `[protect-mode] Project ${projectMeta?.business} is in protect mode (${projectMeta?.protectReason ?? "read-only"}). Provide review/guidance only; do not propose direct writes or claim fixes.`
        );
      }

      const contextPrefix = contextLines.join("\n");

      const result = await runChatTurn({
        userId: tarsUserId,
        message: commentBody,
        contextPrefix,
        titleHint: `Linear ${issueCtx.identifier}: ${issueCtx.title.slice(0, 50)}`,
      });

      const replyText = result.text || "(no response)";

      const postResult = await postLinearComment({
        apiKey,
        issueId,
        body: replyText,
      });

      await writeAdapterAudit({
        runId,
        workflow: "linear-adapter",
        step: "outbound",
        status: postResult.ok ? "ok" : "error",
        message: postResult.error,
        data: {
          issueId,
          identifier: issueCtx.identifier,
          sessionId: result.sessionId,
          replyLength: replyText.length,
          commentId: postResult.commentId,
          visibility,
          protectMode,
        },
      });
    } catch (err) {
      await writeAdapterAudit({
        runId,
        workflow: "linear-adapter",
        step: "handler",
        status: "error",
        message: (err as Error).message,
      });
    }
  })().catch(() => {
    // IIFE handles all errors internally; nothing to do here.
  });

  return NextResponse.json({ ok: true });
}
