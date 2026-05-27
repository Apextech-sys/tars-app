/**
 * Shared PR-review rendering helpers.
 *
 * These functions are used by BOTH the durable workflow (workflows/pr-review.ts,
 * via the agree path's `formatReviewBody`) AND the synchronous adjudication
 * route (app/api/tars/pr-review/disagreement-action/route.ts).
 *
 * Centralising them here guarantees the per-finding output is byte-identical
 * across the agree path and the four adjudication actions.
 *
 * IMPORTANT: this module is intentionally side-effect-free and contains no
 * `"use step"` or `"use workflow"` directives so it is safe to import from
 * Next.js route code without triggering the WDK compiler.
 */

import type { Severity } from "@/workflows/lib/schemas";

/**
 * Reviewer-side raw finding shape, as stored on
 * `pr_review_runs.disagreed_payload.{codex,claude}.findings`. This mirrors
 * the M3 worker output (title / detail / severity / file / line / suggestion).
 */
export interface RawReviewerFinding {
  severity?: string;
  file?: string;
  line?: number;
  title?: string;
  detail?: string;
  message?: string;
  suggestion?: string;
}

/**
 * Canonical TARS finding shape used by the agree path and emitted from
 * `m3ToTarsFindings`. We accept either shape here so the adjudication
 * route can pass raw reviewer findings straight through without remapping
 * mid-route.
 */
export interface CanonicalFinding {
  file: string;
  line?: number;
  severity: Severity;
  message: string;
  suggestion?: string;
}

export type RenderableFinding = CanonicalFinding | RawReviewerFinding;

/**
 * M3 worker severities -> canonical TARS severities. Mirrors `mapM3Severity`
 * in workflows/pr-review.ts; duplicated here so this module has zero deps
 * on the workflow file (which carries `"use workflow"`).
 */
function mapSeverity(s?: string): Severity {
  switch (s) {
    case "critical":
      return "critical";
    case "high":
    case "major":
      return "major";
    case "medium":
    case "minor":
    case "low":
      return "minor";
    case "info":
    case "nit":
      return "nit";
    default:
      return "minor";
  }
}

export function severityLabel(s: Severity): string {
  switch (s) {
    case "critical":
      return "**[CRITICAL]**";
    case "major":
      return "**[major]**";
    case "minor":
      return "[minor]";
    case "nit":
      return "[nit]";
    default:
      return `[${s as string}]`;
  }
}

/**
 * Normalise any input shape into the canonical finding shape used by the
 * markdown renderer. Title + detail are concatenated the same way
 * `m3ToTarsFindings` does it in the agree path.
 */
export function toCanonicalFinding(f: RenderableFinding): CanonicalFinding {
  // Already canonical (has `message` and a typed severity).
  if (
    typeof (f as CanonicalFinding).message === "string" &&
    typeof (f as CanonicalFinding).severity === "string" &&
    !("title" in f) &&
    !("detail" in f)
  ) {
    return f as CanonicalFinding;
  }
  const raw = f as RawReviewerFinding;
  const title = raw.title ?? "";
  const detail = raw.detail ?? "";
  const message =
    title && detail
      ? `${title} — ${detail}`
      : title || detail || raw.message || "(no detail)";
  return {
    file: raw.file ?? "(unknown)",
    line: typeof raw.line === "number" ? raw.line : undefined,
    severity: mapSeverity(raw.severity),
    message,
    suggestion: raw.suggestion,
  };
}

/**
 * Render a single finding as a markdown list item. MUST stay byte-identical
 * to the agree path so adjudicated comments look the same as automated ones.
 */
export function renderFindingMarkdown(input: RenderableFinding): string {
  const f = toCanonicalFinding(input);
  const loc = f.line ? `:${f.line}` : "";
  let line = `- ${severityLabel(f.severity)} \`${f.file}${loc}\` — ${f.message}`;
  if (f.suggestion) {
    line += `\n  - _Suggestion:_ ${f.suggestion}`;
  }
  return line;
}

/**
 * Dedupe by `(file, line, severity, message-prefix)`. Mirrors `dedupeFindings`
 * in workflows/pr-review.ts. Used by the merged-adjudication action.
 */
export function dedupeFindings(
  findings: RenderableFinding[]
): CanonicalFinding[] {
  const seen = new Map<string, CanonicalFinding>();
  for (const raw of findings) {
    const f = toCanonicalFinding(raw);
    const key = `${f.file}|${f.line ?? "?"}|${f.severity}|${f.message.slice(0, 80)}`;
    if (!seen.has(key)) {
      seen.set(key, f);
    }
  }
  return Array.from(seen.values());
}

/**
 * Render the body of an adjudication-post PR comment.
 *
 * The "Findings" section uses `renderFindingMarkdown` so it is byte-identical
 * to the automated agree-path comment for the same set of findings.
 */
export function renderAdjudicatedComment(args: {
  header: string;
  findings: RenderableFinding[];
  overlapRatio?: number;
  note: string;
  prSha?: string;
  adjudicatedBy: string;
}): string {
  const lines: string[] = [];
  lines.push(`## ${args.header}`);
  lines.push("");
  const meta: string[] = [];
  if (typeof args.overlapRatio === "number") {
    meta.push(`**Overlap:** ${Math.round(args.overlapRatio * 100)}%`);
  }
  if (args.prSha) {
    meta.push(`**HEAD:** \`${args.prSha.slice(0, 7)}\``);
  }
  meta.push(`**Adjudicated by:** ${args.adjudicatedBy}`);
  lines.push(meta.join("  |  "));
  lines.push("");
  lines.push(`_${args.note}_`);
  lines.push("");

  if (args.findings.length === 0) {
    lines.push("_No findings to report._");
  } else {
    lines.push(
      `### ${args.findings.length} finding${args.findings.length === 1 ? "" : "s"}`
    );
    lines.push("");
    for (const f of args.findings) {
      lines.push(renderFindingMarkdown(f));
    }
  }

  lines.push("");
  lines.push(
    "<sub>Generated by TARS PR Review workflow (manual adjudication). " +
      "This comment was posted after Shaun reviewed the codex/claude disagreement.</sub>"
  );
  return lines.join("\n");
}
