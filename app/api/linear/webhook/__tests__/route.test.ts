/**
 * Integration test for the Linear webhook route.
 *
 * Mocks runChatTurn + fetchLinearIssueContext + postLinearComment so we never
 * hit Linear or Anthropic for real.
 */
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runChatTurnMock = vi.fn();
const fetchIssueMock = vi.fn();
const postCommentMock = vi.fn();
const mapLinearUserToTarsMock = vi.fn(async (id: string) => `linear:${id}`);
const getAppSettingMock = vi.fn();
const setAppSettingMock = vi.fn(async () => {});
const writeAdapterAuditMock = vi.fn(async () => {});
const loadProjectsByLinearTeamMock = vi.fn(async () => new Map());

vi.mock("@/lib/tars/chat-runner", () => ({
  runChatTurn: runChatTurnMock,
}));
vi.mock("@/lib/tars/linear", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/tars/linear")>(
      "@/lib/tars/linear"
    );
  return {
    ...actual,
    fetchLinearIssueContext: fetchIssueMock,
    postLinearComment: postCommentMock,
    loadProjectsByLinearTeam: loadProjectsByLinearTeamMock,
  };
});
vi.mock("@/lib/tars/user-mapper", () => ({
  mapSlackUserToTars: vi.fn(),
  mapLinearUserToTars: mapLinearUserToTarsMock,
}));
vi.mock("@/lib/tars/app-settings", () => ({
  getAppSetting: getAppSettingMock,
  setAppSetting: setAppSettingMock,
}));
vi.mock("@/lib/tars/adapter-audit", () => ({
  writeAdapterAudit: writeAdapterAuditMock,
}));

const SECRET = "test-linear-webhook-secret";
const API_KEY = "lin_api_test";

function buildSignedRequest(payload: object) {
  const rawBody = JSON.stringify(payload);
  const sig = createHmac("sha256", SECRET)
    .update(rawBody, "utf8")
    .digest("hex");
  return new Request("http://localhost/api/linear/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "linear-signature": sig,
    },
    body: rawBody,
  });
}

async function flushPromises(times = 20) {
  for (let i = 0; i < times; i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("POST /api/linear/webhook", () => {
  beforeEach(() => {
    process.env.LINEAR_WEBHOOK_SECRET = SECRET;
    process.env.LINEAR_API_KEY = API_KEY;
    runChatTurnMock.mockReset();
    fetchIssueMock.mockReset();
    postCommentMock.mockReset();
    mapLinearUserToTarsMock.mockClear();
    getAppSettingMock.mockReset();
    writeAdapterAuditMock.mockClear();
    loadProjectsByLinearTeamMock.mockReset();
    loadProjectsByLinearTeamMock.mockResolvedValue(new Map());

    runChatTurnMock.mockResolvedValue({
      sessionId: "sess-1",
      claudeSessionId: "claude-1",
      text: "linear response",
      finishReason: "stop",
    });
    fetchIssueMock.mockResolvedValue({
      id: "issue-1",
      identifier: "REF-42",
      title: "Test issue",
      description: "desc",
      teamKey: "REF",
      teamName: "Reflex",
      projectName: "Onboarding",
    });
    postCommentMock.mockResolvedValue({ ok: true, commentId: "comment-1" });
    getAppSettingMock.mockResolvedValue(null);
  });

  it("returns 401 on invalid signature", async () => {
    const { POST } = await import("@/app/api/linear/webhook/route");
    const rawBody = JSON.stringify({
      type: "Comment",
      action: "create",
      data: { id: "c1", body: "@tars help", issueId: "issue-1" },
    });
    const req = new Request("http://localhost/api/linear/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "linear-signature": "deadbeef",
      },
      body: rawBody,
    });
    const res = await POST(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(401);
  });

  it("routes @tars comment through chat handler + posts back", async () => {
    const { POST } = await import("@/app/api/linear/webhook/route");
    const req = buildSignedRequest({
      type: "Comment",
      action: "create",
      webhookId: "wh-1",
      data: {
        id: "c1",
        body: "@tars please summarize",
        issueId: "issue-1",
        user: { id: "linear-user-1", name: "Shaun" },
      },
    });
    const res = await POST(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(200);

    await flushPromises(30);
    expect(fetchIssueMock).toHaveBeenCalledOnce();
    expect(runChatTurnMock).toHaveBeenCalledOnce();
    const turnArg = runChatTurnMock.mock.calls[0][0];
    expect(turnArg.message).toBe("@tars please summarize");
    expect(turnArg.contextPrefix).toContain("REF-42");
    expect(turnArg.contextPrefix).toContain("Test issue");

    expect(postCommentMock).toHaveBeenCalledOnce();
    const postArg = postCommentMock.mock.calls[0][0];
    expect(postArg.issueId).toBe("issue-1");
    expect(postArg.body).toBe("linear response");
  });

  it("ignores comments without @tars trigger", async () => {
    const { POST } = await import("@/app/api/linear/webhook/route");
    const req = buildSignedRequest({
      type: "Comment",
      action: "create",
      data: {
        id: "c1",
        body: "regular comment",
        issueId: "issue-1",
      },
    });
    const res = await POST(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(200);

    await flushPromises(10);
    expect(runChatTurnMock).not.toHaveBeenCalled();
    expect(postCommentMock).not.toHaveBeenCalled();
  });

  it("ignores non-Comment events", async () => {
    const { POST } = await import("@/app/api/linear/webhook/route");
    const req = buildSignedRequest({
      type: "Issue",
      action: "update",
      data: { id: "issue-2" },
    });
    const res = await POST(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(200);

    await flushPromises(10);
    expect(runChatTurnMock).not.toHaveBeenCalled();
  });

  it("respects personal-visibility firewall flag in context", async () => {
    loadProjectsByLinearTeamMock.mockResolvedValueOnce(
      new Map([
        [
          "REF",
          {
            business: "shaun",
            visibility: "personal" as const,
            protectMode: false,
          },
        ],
      ])
    );

    const { POST } = await import("@/app/api/linear/webhook/route");
    const req = buildSignedRequest({
      type: "Comment",
      action: "create",
      webhookId: "wh-personal",
      data: {
        id: "c1",
        body: "@tars help",
        issueId: "issue-1",
        user: { id: "linear-user-1", name: "Shaun" },
      },
    });
    const res = await POST(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(200);

    await flushPromises(30);
    expect(runChatTurnMock).toHaveBeenCalledOnce();
    const turnArg = runChatTurnMock.mock.calls[0][0];
    expect(turnArg.contextPrefix).toContain("[firewall]");
    expect(turnArg.contextPrefix).toContain("PERSONAL");
  });

  it("applies protect-mode prefix when project is in protect mode", async () => {
    loadProjectsByLinearTeamMock.mockResolvedValueOnce(
      new Map([
        [
          "REF",
          {
            business: "konverge",
            visibility: "work" as const,
            protectMode: true,
            protectReason: "External P45 contractors",
          },
        ],
      ])
    );

    const { POST } = await import("@/app/api/linear/webhook/route");
    const req = buildSignedRequest({
      type: "Comment",
      action: "create",
      webhookId: "wh-protect",
      data: {
        id: "c1",
        body: "@tars review",
        issueId: "issue-1",
        user: { id: "linear-user-1" },
      },
    });
    const res = await POST(req as unknown as import("next/server").NextRequest);
    expect(res.status).toBe(200);

    await flushPromises(30);
    expect(runChatTurnMock).toHaveBeenCalledOnce();
    const turnArg = runChatTurnMock.mock.calls[0][0];
    expect(turnArg.contextPrefix).toContain("[protect-mode]");
    expect(turnArg.contextPrefix).toContain("konverge");
  });
});
