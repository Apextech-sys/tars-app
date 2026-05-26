import { describe, it, expect } from "vitest";

import {
  assertWriteAllowed,
  canWrite,
  KonvergeProtectModeError,
  type WriteOp,
} from "../lib/konverge-guard";
import type { ResolvedPolicy } from "../lib/policy";

function policyWithProtect(protectMode: boolean): ResolvedPolicy {
  return {
    projectKey: protectMode ? "konverge" : "polymarket-v2",
    matched: true,
    autoReview: true,
    autoFix: !protectMode,
    severityThreshold: "minor",
    issueTracker: "none",
    slackNotify: false,
    slackChannel: null,
    protectMode,
    rawProject: null,
  };
}

const WRITE_OPS: WriteOp[] = [
  "pr-comment",
  "issue-create",
  "git-push",
  "autofix-apply",
  "autofix-propose",
  "slack-post",
];

describe("konverge-guard", () => {
  it("throws KonvergeProtectModeError on every write op when protectMode=true", () => {
    const policy = policyWithProtect(true);
    for (const op of WRITE_OPS) {
      expect(() => assertWriteAllowed(policy, op)).toThrow(
        KonvergeProtectModeError
      );
      try {
        assertWriteAllowed(policy, op);
      } catch (err) {
        expect((err as KonvergeProtectModeError).op).toBe(op);
        expect((err as Error).message).toContain("Konverge protect mode");
      }
    }
  });

  it("passes through on every write op when protectMode=false", () => {
    const policy = policyWithProtect(false);
    for (const op of WRITE_OPS) {
      expect(() => assertWriteAllowed(policy, op)).not.toThrow();
    }
  });

  it("canWrite returns false under protect mode, true otherwise", () => {
    expect(canWrite(policyWithProtect(true), "pr-comment")).toBe(false);
    expect(canWrite(policyWithProtect(false), "pr-comment")).toBe(true);
  });

  it("error name and message identify the op", () => {
    const err = new KonvergeProtectModeError("git-push");
    expect(err.name).toBe("KonvergeProtectModeError");
    expect(err.message).toContain("git-push");
  });
});
