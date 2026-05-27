/**
 * Unit tests for the brief schema contract.
 *
 * The schema is the contract between the brief workflow and the worker
 * handler. If this test breaks, prompt updates in
 * tars-worker/src/handlers/claude-brief-compose.ts have likely drifted
 * from the validator in lib/tars/brief/schema.ts.
 */

import { describe, expect, it } from "vitest";
import {
  BriefComposeInputSchema,
  type BriefOutput,
  BriefOutputSchema,
  renderBriefMarkdown,
} from "../../lib/tars/brief/schema";

describe("BriefOutputSchema", () => {
  it("accepts a minimal valid brief", () => {
    const ok: BriefOutput = {
      summary: "Nothing on fire.",
      body_markdown: "# OK\n\nNothing on fire.",
      insights: [],
      next_actions: [],
      questions: [],
    };
    const parsed = BriefOutputSchema.safeParse(ok);
    expect(parsed.success).toBe(true);
  });

  it("accepts a fully populated brief", () => {
    const out: BriefOutput = {
      summary: "Polymarket-v2 keeps shipping; project gaps need filling.",
      body_markdown:
        "# Morning Brief\n\n## Insights\n- polymarket-v2 had 3 commits.\n",
      insights: [
        {
          severity: "watch",
          title: "polymarket-v2 active",
          detail:
            "3 commits in the last 12 hours, position-replay scoring being refactored.",
          citation: "Apextech-sys/polymarket-v2@1247f2e",
        },
        {
          severity: "act",
          title: "area42 project missing five fields",
          detail:
            "linear_team, slack, vercel_project, supabase_project, aws_account",
          citation: "projects.yaml:area42",
        },
      ],
      next_actions: [
        {
          owner: "shaun",
          title: "Fill projects.yaml gaps for area42",
          detail: "Either populate the missing fields or mark them excluded.",
          link: undefined,
        },
      ],
      questions: [
        {
          question: "Should area42 be archived?",
          why: "Five missing critical fields suggests it may not be a real project.",
          reply_hint: "archive area42 OR fill area42.linear_team = <...>",
        },
      ],
    };
    const parsed = BriefOutputSchema.safeParse(out);
    expect(parsed.success).toBe(true);
  });

  it("rejects missing required keys", () => {
    const bad = { summary: "missing body" };
    const parsed = BriefOutputSchema.safeParse(bad);
    expect(parsed.success).toBe(false);
  });

  it("rejects invalid severity", () => {
    const bad = {
      summary: "s",
      body_markdown: "x",
      insights: [
        {
          severity: "panic",
          title: "x",
          detail: "x",
          citation: "x",
        },
      ],
      next_actions: [],
      questions: [],
    };
    const parsed = BriefOutputSchema.safeParse(bad);
    expect(parsed.success).toBe(false);
  });

  it("rejects insight missing citation", () => {
    const bad = {
      summary: "s",
      body_markdown: "x",
      insights: [
        {
          severity: "info",
          title: "x",
          detail: "x",
        },
      ],
      next_actions: [],
      questions: [],
    };
    const parsed = BriefOutputSchema.safeParse(bad);
    expect(parsed.success).toBe(false);
  });

  it("caps oversized output", () => {
    const huge = {
      summary: "s",
      body_markdown: "x".repeat(50_000),
      insights: [],
      next_actions: [],
      questions: [],
    };
    const parsed = BriefOutputSchema.safeParse(huge);
    expect(parsed.success).toBe(false);
  });
});

describe("BriefComposeInputSchema", () => {
  it("accepts a minimal grounded input", () => {
    const ok = {
      kind: "morning" as const,
      date: "2026-05-26",
      windowStart: "2026-05-25T18:00:00.000Z",
      windowEnd: "2026-05-26T06:00:00.000Z",
      graph: {
        node_counts: { Project: 13, Repo: 100 },
        edge_counts: { OWNS: 100 },
        project_count: 13,
        protected_projects: [],
      },
      projects_yaml_summary: {
        total: 13,
        by_visibility: { personal: 7, work: 6 },
        gaps: [],
      },
      audit_window: {
        total_entries: 0,
        by_outcome: {},
        by_workflow: {},
      },
      recent_repo_activity: [],
      open_prs: [],
      recent_issues: [],
    };
    expect(BriefComposeInputSchema.safeParse(ok).success).toBe(true);
  });

  it("rejects bad kind", () => {
    const parsed = BriefComposeInputSchema.safeParse({ kind: "midday" });
    expect(parsed.success).toBe(false);
  });
});

describe("renderBriefMarkdown", () => {
  it("falls back to a deterministic structure when the model omits body_markdown", () => {
    const out: BriefOutput = {
      summary: "Test",
      body_markdown: "",
      insights: [
        {
          severity: "act",
          title: "T",
          detail: "D",
          citation: "C",
        },
      ],
      next_actions: [
        {
          owner: "shaun",
          title: "Do thing",
          detail: "details",
          link: undefined,
        },
      ],
      questions: [{ question: "Q?", why: "because", reply_hint: undefined }],
    };
    const md = renderBriefMarkdown(out, {
      kind: "morning",
      date: "2026-05-26",
    });
    expect(md).toMatch(/# TARS Morning Brief — 2026-05-26/);
    expect(md).toMatch(/\*\*\[ACT\]\*\*/);
    expect(md).toMatch(/\(shaun\) \*\*Do thing\*\*/);
    expect(md).toMatch(/Q\?/);
  });

  it("labels evening briefs correctly", () => {
    const md = renderBriefMarkdown(
      {
        summary: "x",
        body_markdown: "",
        insights: [],
        next_actions: [],
        questions: [],
      },
      { kind: "evening", date: "2026-05-26" }
    );
    expect(md).toMatch(/# TARS Evening Brief/);
  });
});
