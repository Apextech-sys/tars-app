/**
 * Brief schema — shared validation contract between the brief workflow
 * (workflows/brief.ts) and the worker handler (tars-worker/src/handlers/
 * claude-brief-compose.ts).
 *
 * The contract is intentionally rigid:
 *   - JSON only, no markdown fences
 *   - Every section is non-optional so the prompt cannot silently degrade
 *   - Each "next_action" has an explicit owner so a slipped action is visible
 *
 * IMPORTANT: This file is imported from BOTH the workflow side (which the
 * WDK static analyzer compiles) and the worker side (which is a plain Node
 * process). Keep it dependency-light — zod + nothing else.
 */

import { z } from "zod";

export const BriefKindSchema = z.enum(["morning", "evening", "adhoc"]);
export type BriefKind = z.infer<typeof BriefKindSchema>;

export const InsightSeveritySchema = z.enum(["info", "watch", "act"]);
export type InsightSeverity = z.infer<typeof InsightSeveritySchema>;

export const InsightSchema = z.object({
  severity: InsightSeveritySchema,
  title: z.string().min(1).max(240),
  detail: z.string().min(1).max(2000),
  /**
   * Citation — a graph node name, audit run_id, PR url, or projects.yaml
   * key. The prompt instructs Claude that every insight MUST cite a source.
   */
  citation: z.string().min(1).max(500),
});
export type Insight = z.infer<typeof InsightSchema>;

export const NextActionSchema = z.object({
  /** Who carries this action — Shaun, TARS, or a named partner. */
  owner: z.enum(["shaun", "tars", "partner", "deferred"]),
  title: z.string().min(1).max(240),
  detail: z.string().min(1).max(2000),
  /** Best-effort link to the underlying thing (PR, issue, doc). */
  link: z
    .string()
    .url()
    .nullish()
    .transform((v) => v ?? undefined),
});
export type NextAction = z.infer<typeof NextActionSchema>;

export const BriefQuestionSchema = z.object({
  question: z.string().min(1).max(500),
  why: z.string().min(1).max(1000),
  /** Suggested reply hint Shaun can paste back in chat. */
  reply_hint: z
    .string()
    .min(1)
    .max(500)
    .nullish()
    .transform((v) => v ?? undefined),
});
export type BriefQuestion = z.infer<typeof BriefQuestionSchema>;

/**
 * Top-level shape returned by the compose handler.
 * The workflow validates this on the way back from the worker.
 */
export const BriefOutputSchema = z.object({
  summary: z.string().min(1).max(500),
  body_markdown: z.string().min(1).max(20_000),
  insights: z.array(InsightSchema).min(0).max(20),
  next_actions: z.array(NextActionSchema).min(0).max(20),
  questions: z.array(BriefQuestionSchema).min(0).max(20),
});
export type BriefOutput = z.infer<typeof BriefOutputSchema>;

/**
 * Input payload the workflow dispatches to the claude-brief-compose handler.
 * It's the entire grounded context — graph snapshot, projects.yaml summary,
 * audit slice, repo activity, recent answered questions. The handler does
 * NO additional fetching; everything it sees has to be in here.
 */
export const BriefComposeInputSchema = z.object({
  kind: BriefKindSchema,
  date: z.string(), // ISO date (YYYY-MM-DD)
  windowStart: z.string(), // ISO timestamp
  windowEnd: z.string(), // ISO timestamp
  graph: z.object({
    node_counts: z.record(z.string(), z.number()),
    edge_counts: z.record(z.string(), z.number()),
    project_count: z.number(),
    protected_projects: z.array(
      z.object({
        key: z.string(),
        reason: z.string().optional(),
      })
    ),
  }),
  projects_yaml_summary: z.object({
    total: z.number(),
    by_visibility: z.record(z.string(), z.number()),
    gaps: z.array(
      z.object({
        project: z.string(),
        missing_fields: z.array(z.string()),
      })
    ),
  }),
  audit_window: z.object({
    total_entries: z.number(),
    by_outcome: z.record(z.string(), z.number()),
    by_workflow: z.record(z.string(), z.number()),
  }),
  recent_repo_activity: z
    .array(
      z.object({
        repo: z.string(),
        commits: z.number(),
        latest_sha: z.string().optional(),
        latest_title: z.string().optional(),
        author: z.string().optional(),
      })
    )
    .max(50),
  open_prs: z
    .array(
      z.object({
        repo: z.string(),
        number: z.number(),
        title: z.string(),
        url: z.string(),
        author: z.string().optional(),
        draft: z.boolean().optional(),
      })
    )
    .max(50),
  recent_issues: z
    .array(
      z.object({
        repo: z.string(),
        number: z.number(),
        title: z.string(),
        url: z.string(),
        state: z.string(),
      })
    )
    .max(30),
});
export type BriefComposeInput = z.infer<typeof BriefComposeInputSchema>;

/**
 * Render-time helper — converts a validated BriefOutput plus its metadata
 * into the markdown that gets persisted to `briefs.body_markdown`.
 *
 * The handler is also asked to return `body_markdown` directly; this helper
 * is a fallback used by the workflow if the model omits it, and as a sanity
 * check for tests.
 */
export function renderBriefMarkdown(
  out: BriefOutput,
  meta: { kind: BriefKind; date: string }
): string {
  const lines: string[] = [];
  const headingByKind: Record<BriefKind, string> = {
    morning: "TARS Morning Brief",
    evening: "TARS Evening Brief",
    adhoc: "TARS Briefing",
  };
  const heading = headingByKind[meta.kind];
  lines.push(`# ${heading} — ${meta.date}`);
  lines.push("");
  lines.push(out.summary);
  lines.push("");

  const tagBySeverity: Record<InsightSeverity, string> = {
    act: "**[ACT]**",
    watch: "**[watch]**",
    info: "[info]",
  };
  if (out.insights.length > 0) {
    lines.push("## Insights");
    for (const i of out.insights) {
      const tag = tagBySeverity[i.severity];
      lines.push(`- ${tag} **${i.title}** — ${i.detail}`);
      lines.push(`  - _source:_ ${i.citation}`);
    }
    lines.push("");
  }

  if (out.next_actions.length > 0) {
    lines.push("## Next actions");
    for (const a of out.next_actions) {
      lines.push(`- (${a.owner}) **${a.title}** — ${a.detail}`);
      if (a.link) {
        lines.push(`  - ${a.link}`);
      }
    }
    lines.push("");
  }

  if (out.questions.length > 0) {
    lines.push("## Questions for you");
    for (const q of out.questions) {
      lines.push(`- ${q.question}`);
      lines.push(`  - _why:_ ${q.why}`);
      if (q.reply_hint) {
        lines.push(`  - _reply hint:_ ${q.reply_hint}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}
