/**
 * Slack Events API webhook.
 *
 *   POST /api/slack/events
 *
 * Verifies the Slack signing-secret HMAC, then dispatches the event:
 *   - url_verification: echo challenge (one-time app setup)
 *   - event_callback:
 *       * app_mention                                 → respond in channel
 *       * message with channel_type=im                → respond in DM
 *       * everything else                              → silently ack
 *
 * Channel allowlist: only respond in DMs or in channels listed under
 * app_settings['slack_allowed_channels'] (jsonb string[]).
 *
 * On allowed events:
 *   1. Map the Slack user to a tars user (auto-create anon).
 *   2. Route the text through runChatTurn (same backend as /api/chat).
 *   3. Post the response back via chat.postMessage.
 *   4. Audit every step.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { randomUUID } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { runChatTurn } from "@/lib/tars/chat-runner";
import { writeAdapterAudit } from "@/lib/tars/adapter-audit";
import { getAppSetting, setAppSetting } from "@/lib/tars/app-settings";
import { postSlackMessage, verifySlackSignature } from "@/lib/tars/slack";
import { mapSlackUserToTars } from "@/lib/tars/user-mapper";

interface SlackEventEnvelope {
  type: "url_verification" | "event_callback";
  challenge?: string;
  team_id?: string;
  event_id?: string;
  authorizations?: Array<{ user_id?: string; is_bot?: boolean }>;
  event?: {
    type: string;
    user?: string;
    text?: string;
    channel?: string;
    channel_type?: string;
    ts?: string;
    thread_ts?: string;
    bot_id?: string;
    subtype?: string;
  };
}

const KONVERGE_REVIEW_PREFIX =
  "[Konverge protect mode is active — this is a review-only comment, not a fix or action.]";

function looksLikeKonvergeChannelName(channelName?: string): boolean {
  if (!channelName) return false;
  return (
    channelName === "reflex-connect-p45" ||
    channelName === "#reflex-connect-p45" ||
    channelName === "p45" ||
    channelName === "#p45"
  );
}

function stripBotMention(text: string, botUserId?: string | null): string {
  if (!text) return "";
  if (botUserId) {
    const re = new RegExp(`<@${botUserId}>`, "g");
    return text.replace(re, "").trim();
  }
  return text.replace(/<@[A-Z0-9]+>/g, "").trim();
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!signingSecret || !botToken) {
    await writeAdapterAudit({
      runId: randomUUID(),
      workflow: "slack-adapter",
      step: "config",
      status: "error",
      message: "SLACK_SIGNING_SECRET or SLACK_BOT_TOKEN missing",
    });
    return NextResponse.json(
      { error: "slack adapter not configured" },
      { status: 500 },
    );
  }

  const rawBody = await req.text();
  const sig = req.headers.get("x-slack-signature");
  const ts = req.headers.get("x-slack-request-timestamp");

  if (
    !verifySlackSignature({
      signingSecret,
      signatureHeader: sig,
      timestampHeader: ts,
      rawBody,
    })
  ) {
    await writeAdapterAudit({
      runId: randomUUID(),
      workflow: "slack-adapter",
      step: "verify-signature",
      status: "error",
      message: "invalid signature",
      data: { hasSig: Boolean(sig), hasTs: Boolean(ts) },
    });
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let env: SlackEventEnvelope;
  try {
    env = JSON.parse(rawBody) as SlackEventEnvelope;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (env.type === "url_verification" && env.challenge) {
    return NextResponse.json({ challenge: env.challenge });
  }

  if (env.type !== "event_callback" || !env.event) {
    return NextResponse.json({ ok: true, ignored: "non-event" });
  }

  const runId = env.event_id ?? randomUUID();
  const ev = env.event;

  if (env.authorizations?.[0]?.user_id) {
    const existing = await getAppSetting<string>("slack_bot_user_id");
    if (!existing) {
      await setAppSetting("slack_bot_user_id", env.authorizations[0].user_id);
    }
  }
  const cachedBotUserId = await getAppSetting<string>("slack_bot_user_id");

  if (ev.bot_id || (ev.user && ev.user === cachedBotUserId)) {
    return NextResponse.json({ ok: true, ignored: "bot-echo" });
  }
  if (
    ev.subtype &&
    ev.subtype !== "file_share" &&
    ev.subtype !== "thread_broadcast"
  ) {
    return NextResponse.json({ ok: true, ignored: `subtype:${ev.subtype}` });
  }

  const isDm = ev.type === "message" && ev.channel_type === "im";
  const isMention = ev.type === "app_mention";

  if (!isDm && !isMention) {
    return NextResponse.json({ ok: true, ignored: `type:${ev.type}` });
  }

  if (!ev.user || !ev.channel || !ev.text) {
    await writeAdapterAudit({
      runId,
      workflow: "slack-adapter",
      step: "validate",
      status: "skip",
      message: "missing user/channel/text",
    });
    return NextResponse.json({ ok: true, ignored: "missing-fields" });
  }

  const allowed =
    (await getAppSetting<string[]>("slack_allowed_channels")) ?? [];
  if (!isDm && !allowed.includes(ev.channel)) {
    await writeAdapterAudit({
      runId,
      workflow: "slack-adapter",
      step: "allowlist",
      status: "skip",
      message: "channel not allowed",
      data: { channel: ev.channel, allowed },
    });
    return NextResponse.json({ ok: true, ignored: "channel-not-allowed" });
  }

  await writeAdapterAudit({
    runId,
    workflow: "slack-adapter",
    step: "inbound",
    status: "start",
    data: {
      channel: ev.channel,
      user: ev.user,
      type: ev.type,
      isDm,
      textLength: ev.text.length,
    },
  });

  // Background the heavy work so Slack gets a 200 within 3 seconds.
  void (async () => {
    try {
      const tarsUserId = await mapSlackUserToTars(ev.user as string);
      const cleanText = stripBotMention(ev.text as string, cachedBotUserId);
      if (!cleanText) {
        await writeAdapterAudit({
          runId,
          workflow: "slack-adapter",
          step: "empty-text",
          status: "skip",
          message: "text empty after stripping mention",
        });
        return;
      }

      const contextPrefix = isDm
        ? `(Inbound via Slack DM from ${ev.user}.)`
        : `(Inbound via Slack channel ${ev.channel} from ${ev.user}.)`;

      const result = await runChatTurn({
        userId: tarsUserId,
        message: cleanText,
        contextPrefix,
        titleHint: `Slack: ${cleanText.slice(0, 50)}`,
      });

      let replyText = result.text || "(no response)";

      // Konverge protect mode: if the channel id looks like or maps to konverge,
      // prepend the review-only prefix. Channel id can't always be resolved by
      // name without an extra API call — we apply when channel matches a known
      // Konverge-mapped id OR when channel name (rare case where caller passed
      // a name rather than ID) matches.
      const konvergeChannelIds =
        (await getAppSetting<string[]>("slack_allowed_channels")) ?? [];
      const konvergeBusinessChannels = konvergeChannelIds.filter((c) =>
        looksLikeKonvergeChannelName(c),
      );
      const evChannel = ev.channel as string;
      if (
        looksLikeKonvergeChannelName(evChannel) ||
        konvergeBusinessChannels.includes(evChannel)
      ) {
        replyText = `${KONVERGE_REVIEW_PREFIX}\n\n${replyText}`;
      }

      const postResult = await postSlackMessage({
        botToken,
        channel: ev.channel as string,
        text: replyText,
        threadTs: ev.thread_ts ?? ev.ts,
      });

      await writeAdapterAudit({
        runId,
        workflow: "slack-adapter",
        step: "outbound",
        status: postResult.ok ? "ok" : "error",
        message: postResult.error,
        data: {
          channel: ev.channel,
          sessionId: result.sessionId,
          replyLength: replyText.length,
          ts: postResult.ts,
        },
      });
    } catch (err) {
      await writeAdapterAudit({
        runId,
        workflow: "slack-adapter",
        step: "handler",
        status: "error",
        message: (err as Error).message,
      });
    }
  })();

  return NextResponse.json({ ok: true });
}
