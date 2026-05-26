/**
 * Slack chat.postMessage wrapper.
 *
 * Marked `"use step"`: the Slack SDK uses node:zlib, node:fs etc. which
 * cannot live in workflow code. The workflow function imports and calls this
 * the same way it does any step.
 */

export async function postSlackMessage(args: {
  channel: string;
  text: string;
  blocks?: unknown[];
}): Promise<{ ok: boolean; ts?: string; error?: string }> {
  "use step";
  try {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) {
      return { ok: false, error: "SLACK_BOT_TOKEN not set" };
    }
    // Lazy-import the slack SDK so module load doesn't pull node:zlib into
    // any caller that doesn't actually invoke the step.
    const { WebClient } = await import("@slack/web-api");
    const c = new WebClient(token);
    const resp = await c.chat.postMessage({
      channel: args.channel.startsWith("#") ? args.channel : `#${args.channel}`,
      text: args.text,
      blocks: args.blocks as never,
    });
    return { ok: Boolean(resp.ok), ts: resp.ts };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
