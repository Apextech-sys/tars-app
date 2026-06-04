/**
 * Unit tests: GitHub webhook signature verification + event routing
 * Run with: ./node_modules/.bin/vitest run app/api/webhooks/github/__tests__/
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Inline the signature verifier for pure unit testing without Next.js deps.
// The route exports this logic via the same algorithm -- any change to the
// production implementation must be reflected here.
// ---------------------------------------------------------------------------

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

function makeSignature(body: string, secret: string): string {
  const mac = createHmac("sha256", secret)
    .update(Buffer.from(body))
    .digest("hex");
  return `sha256=${mac}`;
}

const TEST_SECRET = "test-secret-32-bytes-xxxxxxxxxxxx";
const VALID_BODY = JSON.stringify({
  action: "opened",
  repository: { full_name: "Apextech-sys/tars-app" },
});

// ─── Signature verification unit tests ───────────────────────────────────────

describe("verifyGitHubSignature", () => {
  it("passes a valid HMAC-SHA256 signature", () => {
    const sig = makeSignature(VALID_BODY, TEST_SECRET);
    expect(
      verifyGitHubSignature(Buffer.from(VALID_BODY), sig, TEST_SECRET)
    ).toBe(true);
  });

  it("rejects a missing signature header (null)", () => {
    expect(
      verifyGitHubSignature(Buffer.from(VALID_BODY), null, TEST_SECRET)
    ).toBe(false);
  });

  it("rejects a signature without sha256= prefix", () => {
    const mac = createHmac("sha256", TEST_SECRET)
      .update(Buffer.from(VALID_BODY))
      .digest("hex");
    // Provide raw hex without the sha256= prefix
    expect(
      verifyGitHubSignature(Buffer.from(VALID_BODY), mac, TEST_SECRET)
    ).toBe(false);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const sig = makeSignature(VALID_BODY, "wrong-secret");
    expect(
      verifyGitHubSignature(Buffer.from(VALID_BODY), sig, TEST_SECRET)
    ).toBe(false);
  });

  it("rejects a signature over a tampered body", () => {
    const sig = makeSignature(VALID_BODY, TEST_SECRET);
    const tampered = `${VALID_BODY} extra`;
    expect(verifyGitHubSignature(Buffer.from(tampered), sig, TEST_SECRET)).toBe(
      false
    );
  });

  it("rejects a truncated hex signature (length mismatch)", () => {
    const sig = makeSignature(VALID_BODY, TEST_SECRET);
    const truncated = sig.slice(0, -10); // lop off last 5 bytes of hex
    expect(
      verifyGitHubSignature(Buffer.from(VALID_BODY), truncated, TEST_SECRET)
    ).toBe(false);
  });

  it("rejects sha256= with empty value", () => {
    expect(
      verifyGitHubSignature(Buffer.from(VALID_BODY), "sha256=", TEST_SECRET)
    ).toBe(false);
  });

  it("correctly handles binary body content (not just ASCII)", () => {
    const binaryBody = Buffer.from([0x00, 0xff, 0xaa, 0x42, 0x01]);
    const sig = `sha256=${createHmac("sha256", TEST_SECRET).update(binaryBody).digest("hex")}`;
    expect(verifyGitHubSignature(binaryBody, sig, TEST_SECRET)).toBe(true);
  });
});

// ─── Route-level integration tests (mock DB + fetch) ─────────────────────────

// We mock the DB module so the route handler can run without Postgres.
vi.mock("@/lib/db", () => {
  const insertValues = vi.fn().mockResolvedValue(undefined);
  const insertMock = vi.fn().mockReturnValue({ values: insertValues });
  const findFirst = vi.fn();
  return {
    db: {
      insert: insertMock,
      query: {
        repoSettings: { findFirst },
        webhookEvents: { findFirst: vi.fn() },
      },
    },
    __insertValues: insertValues,
    __findFirst: findFirst,
  };
});

// Helper to build a synthetic NextRequest-like Request object
function makeRequest(opts: {
  body: string;
  secret: string;
  method?: string;
  eventType?: string;
  deliveryId?: string;
}): Request {
  const sig = makeSignature(opts.body, opts.secret);
  return new Request("http://localhost/api/webhooks/github", {
    method: opts.method ?? "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": sig,
      "x-github-event": opts.eventType ?? "pull_request",
      "x-github-delivery": opts.deliveryId ?? "test-delivery-id-001",
    },
    body: opts.body,
  });
}

describe("POST /api/webhooks/github — route handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_WEBHOOK_SECRET = TEST_SECRET;
    process.env.API_URL = "http://127.0.0.1:3001";
    // Reset global fetch stub
    vi.unstubAllGlobals();
  });

  it("returns 401 for a request with no signature header", async () => {
    const { POST } = await import("../route");
    const req = new Request("http://localhost/api/webhooks/github", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: VALID_BODY,
    });
    const resp = await POST(req as any);
    expect(resp.status).toBe(401);
  });

  it("returns 401 for a request with an invalid signature", async () => {
    const { POST } = await import("../route");
    const req = new Request("http://localhost/api/webhooks/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": "sha256=deadbeefdeadbeef",
        "x-github-event": "pull_request",
        "x-github-delivery": "test-invalid",
      },
      body: VALID_BODY,
    });
    const resp = await POST(req as any);
    expect(resp.status).toBe(401);
  });

  it("returns 405 for GET requests", async () => {
    const { GET } = await import("../route");
    const resp = GET();
    expect(resp.status).toBe(405);
    expect(resp.headers.get("Allow")).toBe("POST");
  });

  it("returns 204 for an un-watched repo (valid signature)", async () => {
    const { POST } = await import("../route");
    const { db } = await import("@/lib/db");
    (db.query.repoSettings.findFirst as any).mockResolvedValue(null);

    const body = JSON.stringify({
      action: "opened",
      number: 1,
      pull_request: {
        head: { sha: "abc123" },
        title: "test",
        draft: false,
      },
      repository: {
        full_name: "unknown/not-watched",
        owner: { login: "unknown" },
        name: "not-watched",
      },
      sender: { login: "test-user" },
    });

    const resp = await POST(makeRequest({ body, secret: TEST_SECRET }) as any);
    expect(resp.status).toBe(204);
  });

  it("returns 202 and triggers workflow for a watched repo PR opened event", async () => {
    const { POST } = await import("../route");
    const { db } = await import("@/lib/db");
    (db.query.repoSettings.findFirst as any).mockResolvedValue({
      repoKey: "Apextech-sys/tars-app",
      owner: "Apextech-sys",
      repo: "tars-app",
      webhookEnabled: true,
      autoFix: true,
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ workflowRunId: "wfr_test_happy_path" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const body = JSON.stringify({
      action: "opened",
      number: 42,
      pull_request: {
        head: { sha: "sha_happy" },
        title: "feat: test PR",
        draft: false,
      },
      repository: {
        full_name: "Apextech-sys/tars-app",
        owner: { login: "Apextech-sys" },
        name: "tars-app",
      },
      sender: { login: "dev-user" },
    });

    const resp = await POST(makeRequest({ body, secret: TEST_SECRET }) as any);
    expect(resp.status).toBe(202);

    const data = await resp.json();
    expect(data.accepted).toBe(true);
    expect(data.prNumber).toBe(42);
    expect(data.workflowRunId).toBe("wfr_test_happy_path");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:3001/api/tars/pr-review",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("passes policyOverride { autoFix: false } for Konverge repos", async () => {
    const { POST } = await import("../route");
    const { db } = await import("@/lib/db");
    (db.query.repoSettings.findFirst as any).mockResolvedValue({
      repoKey: "Apextech-Dev/reflex-connect-aws",
      owner: "Apextech-Dev",
      repo: "reflex-connect-aws",
      webhookEnabled: true,
      autoFix: false, // Konverge repo -- read-only
    });

    let capturedBody: any;
    const mockFetch = vi.fn().mockImplementation((_url: string, opts: any) => {
      capturedBody = JSON.parse(opts.body as string);
      return Promise.resolve({
        ok: true,
        json: async () => ({ workflowRunId: "wfr_konverge_guard" }),
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    const body = JSON.stringify({
      action: "opened",
      number: 7,
      pull_request: {
        head: { sha: "konverge-sha" },
        title: "konverge PR",
        draft: false,
      },
      repository: {
        full_name: "Apextech-Dev/reflex-connect-aws",
        owner: { login: "Apextech-Dev" },
        name: "reflex-connect-aws",
      },
      sender: { login: "konverge-bot" },
    });

    const resp = await POST(makeRequest({ body, secret: TEST_SECRET }) as any);
    expect(resp.status).toBe(202);
    // First line of defense: policyOverride must be passed to the workflow
    expect(capturedBody.policyOverride).toEqual({ autoFix: false });
  });

  it("returns 204 and skips workflow for draft PRs on non-ready_for_review action", async () => {
    const { POST } = await import("../route");
    const { db } = await import("@/lib/db");
    (db.query.repoSettings.findFirst as any).mockResolvedValue({
      repoKey: "Apextech-sys/tars-app",
      webhookEnabled: true,
      autoFix: true,
    });

    const body = JSON.stringify({
      action: "opened",
      number: 99,
      pull_request: {
        head: { sha: "draft-sha" },
        title: "WIP: not ready",
        draft: true,
      },
      repository: {
        full_name: "Apextech-sys/tars-app",
        owner: { login: "Apextech-sys" },
        name: "tars-app",
      },
      sender: { login: "dev" },
    });

    const resp = await POST(makeRequest({ body, secret: TEST_SECRET }) as any);
    expect(resp.status).toBe(204);
  });

  it("returns 204 for non-PR events (push)", async () => {
    const { POST } = await import("../route");
    const { db } = await import("@/lib/db");
    (db.query.repoSettings.findFirst as any).mockResolvedValue({
      repoKey: "Apextech-sys/tars-app",
      webhookEnabled: true,
      autoFix: true,
    });

    const body = JSON.stringify({
      ref: "refs/heads/main",
      repository: {
        full_name: "Apextech-sys/tars-app",
        owner: { login: "Apextech-sys" },
        name: "tars-app",
      },
      sender: { login: "dev" },
    });

    const resp = await POST(
      makeRequest({
        body,
        secret: TEST_SECRET,
        eventType: "push",
      }) as any
    );
    expect(resp.status).toBe(204);
  });

  it("returns 202 even if internal workflow call fails (resilience)", async () => {
    const { POST } = await import("../route");
    const { db } = await import("@/lib/db");
    (db.query.repoSettings.findFirst as any).mockResolvedValue({
      repoKey: "Apextech-sys/tars-app",
      webhookEnabled: true,
      autoFix: true,
    });

    const mockFetch = vi
      .fn()
      .mockRejectedValue(new Error("connection refused"));
    vi.stubGlobal("fetch", mockFetch);

    const body = JSON.stringify({
      action: "opened",
      number: 10,
      pull_request: {
        head: { sha: "resilience-sha" },
        title: "test",
        draft: false,
      },
      repository: {
        full_name: "Apextech-sys/tars-app",
        owner: { login: "Apextech-sys" },
        name: "tars-app",
      },
      sender: { login: "dev" },
    });

    // Even if the workflow dispatch fails, we still return 202
    // (GitHub won't retry unnecessarily; the event is logged)
    const resp = await POST(makeRequest({ body, secret: TEST_SECRET }) as any);
    expect(resp.status).toBe(202);
    const data = await resp.json();
    expect(data.workflowRunId).toBeNull();
  });
});
