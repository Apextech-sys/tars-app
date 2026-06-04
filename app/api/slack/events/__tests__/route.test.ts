/**
 * Integration test for the Slack events route.
 *
 * Mocks:
 *   - @/lib/tars/chat-runner   (runChatTurn)
 *   - @/lib/tars/slack         (postSlackMessage)
 *   - @/lib/tars/app-settings  (getAppSetting/setAppSetting)
 *   - @/lib/tars/adapter-audit (writeAdapterAudit)
 *   - @/lib/tars/user-mapper   (mapSlackUserToTars)
 *
 * Tests:
 *   1. url_verification handshake returns the challenge.
 *   2. invalid signature → 401.
 *   3. valid app_mention → internal chat handler called + slack post.
 *   4. DM → handler called even without channel allowlist.
 *   5. mention in non-allowed channel → ignored.
 */
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runChatTurnMock = vi.fn();
const postSlackMessageMock = vi.fn();
const mapSlackUserToTarsMock = vi.fn(async (id: string) => `slack:${id}`);
const getAppSettingMock = vi.fn();
const setAppSettingMock = vi
  .fn<() => Promise<void>>()
  .mockResolvedValue(undefined);
const writeAdapterAuditMock = vi
  .fn<() => Promise<void>>()
  .mockResolvedValue(undefined);

vi.mock("@/lib/tars/chat-runner", () => ({
  runChatTurn: runChatTurnMock,
}));
vi.mock("@/lib/tars/slack", async () => {
  // Re-export the real verifySlackSignature but stub postSlackMessage.
  const actual =
    await vi.importActual<typeof import("@/lib/tars/slack")>(
      "@/lib/tars/slack"
    );
  return {
    ...actual,
    postSlackMessage: postSlackMessageMock,
  };
});
vi.mock("@/lib/tars/user-mapper", () => ({
  mapSlackUserToTars: mapSlackUserToTarsMock,
  mapLinearUserToTars: vi.fn(),
}));
vi.mock("@/lib/tars/app-settings", () => ({
  getAppSetting: getAppSettingMock,
  setAppSetting: setAppSettingMock,
}));
vi.mock("@/lib/tars/adapter-audit", () => ({
  writeAdapterAudit: writeAdapterAuditMock,
}));

const SIGNING_SECRET = "test-signing-secret";
const BOT_TOKEN = "xoxb-test";

function buildSignedRequest(body: object, opts: { stale?: boolean } = {}) {
  const rawBody = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000) - (opts.stale ? 1000 : 0));
  const sig = `v0=${createHmac("sha256", SIGNING_SECRET)
    .update(`v0:${ts}:${rawBody}`)
    .digest("hex")}`;
  return new Request("http://localhost/api/slack/events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-slack-signature": sig,
      "x-slack-request-timestamp": ts,
    },
    body: rawBody,
  });
}

// Wait for the route's background void(...)() to settle.
async function flushPromises(times = 5) {
  for (let i = 0; i < times; i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("POST /api/slack/events", () => {
  beforeEach(() => {
    process.env.SLACK_SIGNING_SECRET = SIGNING_SECRET;
    process.env.SLACK_BOT_TOKEN = BOT_TOKEN;
    runChatTurnMock.mockReset();
    postSlackMessageMock.mockReset();
    mapSlackUserToTarsMock.mockClear();
    getAppSettingMock.mockReset();
    setAppSettingMock.mockClear();
    writeAdapterAuditMock.mockClear();
    runChatTurnMock.mockResolvedValue({
      sessionId: "sess-1",
      claudeSessionId: "claude-1",
      text: "hello from TARS",
      finishReason: "stop",
    });
    postSlackMessageMock.mockResolvedValue({ ok: true, ts: "1.1" });
  });

  it("returns challenge on url_verification", async () => {
    const { POST } = await import("@/app/api/slack/events/route");
    const req = buildSignedRequest({
      type: "url_verification",
      challenge: "abc123",
    });
    const res = await POST(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { challenge: string };
    expect(json.challenge).toBe("abc123");
  });

  it("returns 401 on invalid signature", async () => {
    const { POST } = await import("@/app/api/slack/events/route");
    const rawBody = JSON.stringify({ type: "event_callback" });
    const req = new Request("http://localhost/api/slack/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-slack-signature": "v0=badsig",
        "x-slack-request-timestamp": String(Math.floor(Date.now() / 1000)),
      },
      body: rawBody,
    });
    const res = await POST(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(401);
  });

  it("routes app_mention through chat handler and posts response", async () => {
    getAppSettingMock.mockImplementation((k: string) => {
      if (k === "slack_allowed_channels") {
        return ["C123"];
      }
      if (k === "slack_bot_user_id") {
        return "UBOT";
      }
      return null;
    });

    const { POST } = await import("@/app/api/slack/events/route");
    const req = buildSignedRequest({
      type: "event_callback",
      event_id: "evt-1",
      authorizations: [{ user_id: "UBOT" }],
      event: {
        type: "app_mention",
        user: "USHAUN",
        text: "<@UBOT> hello",
        channel: "C123",
        ts: "100.0",
      },
    });
    const res = await POST(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(200);

    await flushPromises(20);
    expect(runChatTurnMock).toHaveBeenCalledOnce();
    const arg = runChatTurnMock.mock.calls[0][0];
    expect(arg.userId).toBe("slack:USHAUN");
    expect(arg.message).toBe("hello");

    expect(postSlackMessageMock).toHaveBeenCalledOnce();
    const postArg = postSlackMessageMock.mock.calls[0][0];
    expect(postArg.channel).toBe("C123");
    expect(postArg.text).toBe("hello from TARS");
  });

  it("routes DM even without allowlist", async () => {
    getAppSettingMock.mockImplementation((k: string) => {
      if (k === "slack_allowed_channels") {
        return [];
      }
      if (k === "slack_bot_user_id") {
        return "UBOT";
      }
      return null;
    });

    const { POST } = await import("@/app/api/slack/events/route");
    const req = buildSignedRequest({
      type: "event_callback",
      event_id: "evt-2",
      authorizations: [{ user_id: "UBOT" }],
      event: {
        type: "message",
        channel_type: "im",
        user: "USHAUN",
        text: "private message",
        channel: "D123",
        ts: "101.0",
      },
    });
    const res = await POST(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(200);

    await flushPromises(20);
    expect(runChatTurnMock).toHaveBeenCalledOnce();
    expect(postSlackMessageMock).toHaveBeenCalledOnce();
    expect(postSlackMessageMock.mock.calls[0][0].channel).toBe("D123");
  });

  it("ignores mention in non-allowed channel", async () => {
    getAppSettingMock.mockImplementation((k: string) => {
      if (k === "slack_allowed_channels") {
        return ["C-allowed"];
      }
      if (k === "slack_bot_user_id") {
        return "UBOT";
      }
      return null;
    });

    const { POST } = await import("@/app/api/slack/events/route");
    const req = buildSignedRequest({
      type: "event_callback",
      event_id: "evt-3",
      authorizations: [{ user_id: "UBOT" }],
      event: {
        type: "app_mention",
        user: "USHAUN",
        text: "<@UBOT> hello",
        channel: "C-blocked",
        ts: "102.0",
      },
    });
    const res = await POST(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(200);

    await flushPromises(10);
    expect(runChatTurnMock).not.toHaveBeenCalled();
    expect(postSlackMessageMock).not.toHaveBeenCalled();
  });

  it("ignores echoes from the bot itself", async () => {
    getAppSettingMock.mockImplementation((k: string) => {
      if (k === "slack_allowed_channels") {
        return ["C123"];
      }
      if (k === "slack_bot_user_id") {
        return "UBOT";
      }
      return null;
    });

    const { POST } = await import("@/app/api/slack/events/route");
    const req = buildSignedRequest({
      type: "event_callback",
      event_id: "evt-4",
      authorizations: [{ user_id: "UBOT" }],
      event: {
        type: "message",
        bot_id: "B123",
        user: "UBOT",
        text: "self echo",
        channel: "C123",
        ts: "103.0",
      },
    });
    const res = await POST(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(200);

    await flushPromises(10);
    expect(runChatTurnMock).not.toHaveBeenCalled();
    expect(postSlackMessageMock).not.toHaveBeenCalled();
  });
});
