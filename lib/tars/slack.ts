/**
 * Slack adapter primitives:
 *   - verifySlackSignature: HMAC-SHA256 over v0:{timestamp}:{body}
 *   - postSlackMessage: chat.postMessage with SLACK_BOT_TOKEN
 *
 * No "use step" — these are plain async helpers usable from route handlers.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface VerifySlackArgs {
  signingSecret: string;
  signatureHeader: string | null;
  timestampHeader: string | null;
  rawBody: string;
  /** Reject events older than this. Default 5 minutes. */
  maxAgeSeconds?: number;
  /** Inject 'now' for tests. */
  now?: () => number;
}

export function verifySlackSignature(args: VerifySlackArgs): boolean {
  const {
    signingSecret,
    signatureHeader,
    timestampHeader,
    rawBody,
    maxAgeSeconds = 300,
  } = args;
  if (!signatureHeader || !timestampHeader) return false;
  if (!signingSecret) return false;

  const nowSec = Math.floor((args.now ? args.now() : Date.now()) / 1000);
  const ts = Number.parseInt(timestampHeader, 10);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(nowSec - ts) > maxAgeSeconds) return false;

  const baseString = `v0:${timestampHeader}:${rawBody}`;
  const expected = `v0=${createHmac("sha256", signingSecret)
    .update(baseString)
    .digest("hex")}`;

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signatureHeader, "utf8");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export interface PostSlackArgs {
  botToken: string;
  channel: string;
  text: string;
  threadTs?: string;
  /** Used in tests to stub fetch. */
  fetchImpl?: typeof fetch;
}

export interface SlackPostResult {
  ok: boolean;
  ts?: string;
  channel?: string;
  error?: string;
}

export async function postSlackMessage(
  args: PostSlackArgs,
): Promise<SlackPostResult> {
  const f = args.fetchImpl ?? fetch;
  const res = await f("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${args.botToken}`,
    },
    body: JSON.stringify({
      channel: args.channel,
      text: args.text,
      thread_ts: args.threadTs,
    }),
  });
  const json = (await res.json()) as SlackPostResult;
  return json;
}

export async function getSlackChannelInfo(args: {
  botToken: string;
  channelId: string;
  fetchImpl?: typeof fetch;
}): Promise<{ id: string; name?: string; isIm?: boolean } | null> {
  const f = args.fetchImpl ?? fetch;
  try {
    const res = await f(
      `https://slack.com/api/conversations.info?channel=${encodeURIComponent(args.channelId)}`,
      {
        headers: { Authorization: `Bearer ${args.botToken}` },
      },
    );
    const json = (await res.json()) as {
      ok: boolean;
      channel?: { id: string; name?: string; is_im?: boolean };
    };
    if (!json.ok || !json.channel) return null;
    return {
      id: json.channel.id,
      name: json.channel.name,
      isIm: json.channel.is_im,
    };
  } catch {
    return null;
  }
}
