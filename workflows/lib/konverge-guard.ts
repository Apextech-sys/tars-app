/**
 * HARDCODED Konverge protect-mode guard.
 *
 * Konverge is a Partner, not a Customer. We have read-only graph access only.
 * ANY write operation (PR comment, issue create, git push, autofix apply,
 * Slack post) must throw if the resolved policy has `protectMode === true`.
 *
 * This intentionally lives in its own file so audits can grep `KonvergeProtectModeError`
 * to verify the guard is in place wherever a write happens.
 */

import type { ResolvedPolicy } from "./policy";

export type WriteOp =
  | "pr-comment"
  | "issue-create"
  | "git-push"
  | "autofix-apply"
  | "autofix-propose"
  | "slack-post";

export class KonvergeProtectModeError extends Error {
  readonly op: WriteOp;
  constructor(op: WriteOp) {
    super(
      `Konverge protect mode is active — refusing write op "${op}". Konverge is a Partner; no writes allowed.`
    );
    this.op = op;
    this.name = "KonvergeProtectModeError";
  }
}

export function assertWriteAllowed(policy: ResolvedPolicy, op: WriteOp): void {
  if (policy.protectMode) {
    throw new KonvergeProtectModeError(op);
  }
}

/**
 * Convenience wrapper for try/catch handlers — returns true if a write should
 * proceed, false if guard would block. Caller is responsible for logging the
 * skip when this returns false.
 */
export function canWrite(policy: ResolvedPolicy, _op: WriteOp): boolean {
  return !policy.protectMode;
}
