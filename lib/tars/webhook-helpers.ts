/**
 * Shared display helpers for the /webhooks console: decoding the composite
 * action strings the GitHub ingest route writes (e.g. "closed__merged",
 * "opened__draft_skip") into human labels + outcome semantics, and relative
 * time formatting. Pure, no DB — safe in both server and client components.
 */

export type WebhookOutcome = "triggered" | "merged" | "skipped" | "no_action";

const RE_DRAFT_SKIP = /draft_skip/i;
const RE_FIX_MERGED = /fix_merged/i;
const RE_MERGED = /__merged$/i;

export interface DecodedAction {
  /** Human label for the action, e.g. "Merged", "Skipped (draft)", "Opened". */
  label: string;
  /** Coarse outcome bucket for icon/tone selection. */
  outcome: WebhookOutcome;
}

const ACTION_LABELS: Record<string, string> = {
  opened: "Opened",
  synchronize: "Synchronized",
  edited: "Edited",
  closed: "Closed",
  labeled: "Labeled",
  unlabeled: "Unlabeled",
  reopened: "Reopened",
  ready_for_review: "Ready for review",
  converted_to_draft: "Converted to draft",
  assigned: "Assigned",
};

/**
 * Decode a webhook action string + its triggered-run state into a label and
 * an outcome bucket. `triggered` wins over everything (a run fired); merged /
 * draft-skip / composite markers are decoded from the raw action string.
 */
export function decodeAction(
  action: string | null,
  hasTriggeredRun: boolean
): DecodedAction {
  if (action && (RE_MERGED.test(action) || RE_FIX_MERGED.test(action))) {
    const fix = RE_FIX_MERGED.test(action);
    return {
      label: fix ? "Fix PR merged" : "Merged",
      outcome: "merged",
    };
  }
  if (action && RE_DRAFT_SKIP.test(action)) {
    return { label: "Skipped (draft)", outcome: "skipped" };
  }
  if (hasTriggeredRun) {
    const base = action ? (ACTION_LABELS[action] ?? action) : "Triggered";
    return { label: base, outcome: "triggered" };
  }
  if (!action) {
    return { label: "—", outcome: "no_action" };
  }
  const label = ACTION_LABELS[action] ?? action.replace(/__/g, " · ");
  return { label, outcome: "no_action" };
}

const SECONDS = 1000;
const MINUTE = 60 * SECONDS;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Compact relative time, e.g. "12s ago", "4m ago", "3h ago", "2d ago". */
export function relativeTime(iso: string | null): string {
  if (!iso) {
    return "never";
  }
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < MINUTE) {
    return `${Math.max(0, Math.floor(diff / SECONDS))}s ago`;
  }
  if (diff < HOUR) {
    return `${Math.floor(diff / MINUTE)}m ago`;
  }
  if (diff < DAY) {
    return `${Math.floor(diff / HOUR)}h ago`;
  }
  return `${Math.floor(diff / DAY)}d ago`;
}
