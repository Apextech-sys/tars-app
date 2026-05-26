import { claudeFixApplyHandler } from "./claude-fix-apply.js";
import { claudeReviewHandler } from "./claude-review.js";
import { codexFixValidateHandler } from "./codex-fix-validate.js";
import { codexReviewHandler } from "./codex-review.js";
import { noOpHandler } from "./no-op.js";
import type { JobHandler } from "../types.js";

export const HANDLERS: Record<string, JobHandler> = {
  "no-op": noOpHandler,
  "claude-review": claudeReviewHandler,
  "codex-review": codexReviewHandler,
  "claude-fix-apply": claudeFixApplyHandler,
  "codex-fix-validate": codexFixValidateHandler,
};

export function getHandler(kind: string): JobHandler | undefined {
  return HANDLERS[kind];
}

export function knownKinds(): string[] {
  return Object.keys(HANDLERS);
}
