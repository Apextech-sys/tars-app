import { z } from "zod";

/** A single finding the OTHER reviewer raised, passed into a debate round. */
export const DebateFindingSchema = z.object({
  severity: z.string().optional(),
  file: z.string().optional(),
  line: z.number().optional(),
  title: z.string().optional(),
  detail: z.string().optional(),
  message: z.string().optional(),
  suggestion: z.string().optional(),
});

/**
 * Round-2+ debate context. When present, the reviewer is shown the OTHER
 * reviewer's findings and asked to reconsider: endorse ones it now agrees with,
 * defend or retract its own that the other side didn't raise.
 */
export const DebateContextSchema = z.object({
  round: z.number(),
  otherReviewer: z.string(),
  otherFindings: z.array(DebateFindingSchema),
  ownFindings: z.array(DebateFindingSchema).optional(),
});

export type DebateFinding = z.infer<typeof DebateFindingSchema>;
export type DebateContext = z.infer<typeof DebateContextSchema>;

/** Human-readable text for one of the other reviewer's findings. */
function findingText(f: DebateFinding): string {
  if (f.title && f.detail) {
    return `${f.title} — ${f.detail}`;
  }
  return f.title ?? f.detail ?? f.message ?? "(no detail)";
}

/** Bulleted list of the other reviewer's findings (or a "none" line). */
export function formatOtherFindings(findings: DebateFinding[]): string {
  if (findings.length === 0) {
    return "(none — the other reviewer reported no findings)";
  }
  return findings
    .map((f, i) => {
      const loc = f.file
        ? `${f.file}${f.line ? `:${f.line}` : ""}`
        : "(no file)";
      return `${i + 1}. [${f.severity ?? "?"}] ${loc} — ${findingText(f)}`;
    })
    .join("\n");
}

/**
 * The shared instruction block appended to a reviewer's prompt on round 2+.
 * Both Codex and Claude use the same reconsideration contract.
 */
export function debateInstruction(
  round: number,
  otherReviewer: string,
  findings: DebateFinding[]
): string {
  return [
    `DEBATE — round ${round}. You previously reviewed this SAME diff. Another reviewer (${otherReviewer}) reviewed it too; their findings:`,
    formatOtherFindings(findings),
    "Reconsider: endorse (INCLUDE) any of their findings you now agree are real, in-scope defects; OMIT ones you think are wrong/out-of-scope/invented. Keep your own earlier findings only if you still believe they are real and in-scope (defend), else drop them (retract). Note brief reasoning in each finding's detail. SCOPE rules still apply. Return the full UPDATED findings JSON.",
  ].join("\n\n");
}
