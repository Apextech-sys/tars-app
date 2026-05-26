import { describe, expect, it } from "vitest";
import { claudeReviewHandler } from "../../src/handlers/claude-review.js";
import type { JobRow } from "../../src/types.js";

describe("claude-review handler (real Claude Agent SDK)", () => {
  it("returns a valid review for a tiny diff fixture", async () => {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.warn(
        "ANTHROPIC_API_KEY not set — skipping live Claude review test",
      );
      return;
    }

    const diff = [
      "diff --git a/src/utils.ts b/src/utils.ts",
      "@@",
      "-export function add(a: number, b: number) {",
      "-  return a - b;",
      "-}",
      "+export function add(a: number, b: number) {",
      "+  return a + b;",
      "+}",
      "",
    ].join("\n");

    const job: JobRow = {
      id: "test-job",
      kind: "claude-review",
      payload: {
        diff,
        context: "Tiny utility lib. Function name implies addition.",
      },
      status: "running",
      result: null,
      errorText: null,
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
      attempts: 1,
      maxAttempts: 3,
      idempotencyKey: null,
      sessionId: null,
      callbackUrl: null,
      callbackSignedToken: null,
      workerId: "test",
      lockedAt: new Date(),
    };

    const ctx = {
      job,
      signal: new AbortController().signal,
      updateSessionId: async () => undefined,
      log: () => undefined,
    };

    const result = (await claudeReviewHandler(ctx)) as {
      summary: string;
      findings: unknown[];
      verdict: string;
    };

    expect(typeof result.summary).toBe("string");
    expect(result.summary.length).toBeGreaterThan(0);
    expect(Array.isArray(result.findings)).toBe(true);
    expect(["approve", "request-changes", "comment", "block"]).toContain(
      result.verdict,
    );
  }, 180_000);
});
