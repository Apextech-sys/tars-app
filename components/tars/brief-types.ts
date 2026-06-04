/**
 * Shared types + defensive parsers for the /briefs redesign.
 *
 * `briefs.insights` (jsonb) stores the ENTIRE BriefOutput object
 * ({ summary, body_markdown, insights[], next_actions[], questions[] }) per
 * finalizeBrief (workflows/brief-lib/brief-store.ts). `briefs.source_context`
 * is a SEPARATE jsonb column with the grounding the workflow gathered.
 *
 * These parsers are deliberately tolerant: the table can be empty, a row may
 * be mid-compose, or the model may have produced a partial object. We never
 * throw — we coerce to safe shapes so the page always renders.
 */

export type InsightSeverity = "info" | "watch" | "act";
export type ActionOwner = "shaun" | "tars" | "partner" | "deferred";

export interface BriefInsight {
  severity: InsightSeverity;
  title: string;
  detail: string;
  citation: string;
}

export interface BriefNextAction {
  owner: ActionOwner;
  title: string;
  detail: string;
  link?: string;
}

export interface BriefQuestionItem {
  question: string;
  why: string;
  reply_hint?: string;
}

export interface BriefOutputShape {
  summary: string;
  body_markdown: string;
  insights: BriefInsight[];
  next_actions: BriefNextAction[];
  questions: BriefQuestionItem[];
}

export interface RepoActivity {
  repo: string;
  commits: number;
  latest_sha?: string;
  latest_title?: string;
  author?: string;
}

export interface OpenPr {
  repo: string;
  number: number;
  title: string;
  url: string;
  author?: string;
  draft?: boolean;
}

export interface RecentIssue {
  repo: string;
  number: number;
  title: string;
  url: string;
  state: string;
}

export interface SourceContextShape {
  kind?: string;
  date?: string;
  windowStart?: string;
  windowEnd?: string;
  graph?: {
    node_counts?: Record<string, number>;
    edge_counts?: Record<string, number>;
    project_count?: number;
    protected_projects?: { key: string; reason?: string }[];
  };
  projects_yaml_summary?: {
    total?: number;
    by_visibility?: Record<string, number>;
    gaps?: { project: string; missing_fields: string[] }[];
  };
  audit_window?: {
    total_entries?: number;
    by_outcome?: Record<string, number>;
    by_workflow?: Record<string, number>;
  };
  recent_repo_activity?: RepoActivity[];
  open_prs?: OpenPr[];
  recent_issues?: RecentIssue[];
  _availability?: Record<string, boolean>;
}

const VALID_SEVERITIES: InsightSeverity[] = ["info", "watch", "act"];
const VALID_OWNERS: ActionOwner[] = ["shaun", "tars", "partner", "deferred"];

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function asNumber(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function parseInsight(raw: unknown): BriefInsight {
  const r = asRecord(raw);
  const sev = asString(r.severity) as InsightSeverity;
  const severity = VALID_SEVERITIES.includes(sev) ? sev : "info";
  return {
    severity,
    title: asString(r.title, "Untitled insight"),
    detail: asString(r.detail),
    citation: asString(r.citation),
  };
}

function parseAction(raw: unknown): BriefNextAction {
  const r = asRecord(raw);
  const own = asString(r.owner) as ActionOwner;
  const owner = VALID_OWNERS.includes(own) ? own : "tars";
  const link = asString(r.link);
  return {
    owner,
    title: asString(r.title, "Untitled action"),
    detail: asString(r.detail),
    link: link.length > 0 ? link : undefined,
  };
}

function parseQuestion(raw: unknown): BriefQuestionItem {
  const r = asRecord(raw);
  const hint = asString(r.reply_hint);
  return {
    question: asString(r.question, "(no question)"),
    why: asString(r.why),
    reply_hint: hint.length > 0 ? hint : undefined,
  };
}

/** Parse the `briefs.insights` jsonb into a safe BriefOutputShape. */
export function parseBriefOutput(raw: unknown): BriefOutputShape {
  const r = asRecord(raw);
  return {
    summary: asString(r.summary),
    body_markdown: asString(r.body_markdown),
    insights: asArray(r.insights).map(parseInsight),
    next_actions: asArray(r.next_actions).map(parseAction),
    questions: asArray(r.questions).map(parseQuestion),
  };
}

function parseRepoActivity(raw: unknown): RepoActivity {
  const r = asRecord(raw);
  return {
    repo: asString(r.repo),
    commits: asNumber(r.commits),
    latest_sha: asString(r.latest_sha) || undefined,
    latest_title: asString(r.latest_title) || undefined,
    author: asString(r.author) || undefined,
  };
}

function parseOpenPr(raw: unknown): OpenPr {
  const r = asRecord(raw);
  return {
    repo: asString(r.repo),
    number: asNumber(r.number),
    title: asString(r.title),
    url: asString(r.url),
    author: asString(r.author) || undefined,
    draft: r.draft === true,
  };
}

function parseRecentIssue(raw: unknown): RecentIssue {
  const r = asRecord(raw);
  return {
    repo: asString(r.repo),
    number: asNumber(r.number),
    title: asString(r.title),
    url: asString(r.url),
    state: asString(r.state),
  };
}

function parseAvailability(raw: unknown): Record<string, boolean> {
  const r = asRecord(raw);
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(r)) {
    out[k] = v === true;
  }
  return out;
}

/** Parse the `briefs.source_context` jsonb into a safe SourceContextShape. */
export function parseSourceContext(raw: unknown): SourceContextShape {
  const r = asRecord(raw);
  const graph = asRecord(r.graph);
  const projects = asRecord(r.projects_yaml_summary);
  const audit = asRecord(r.audit_window);
  return {
    kind: asString(r.kind) || undefined,
    date: asString(r.date) || undefined,
    windowStart: asString(r.windowStart) || undefined,
    windowEnd: asString(r.windowEnd) || undefined,
    graph: {
      node_counts: asRecord(graph.node_counts) as Record<string, number>,
      edge_counts: asRecord(graph.edge_counts) as Record<string, number>,
      project_count: asNumber(graph.project_count),
      protected_projects: asArray(graph.protected_projects).map((p) => {
        const pr = asRecord(p);
        return {
          key: asString(pr.key),
          reason: asString(pr.reason) || undefined,
        };
      }),
    },
    projects_yaml_summary: {
      total: asNumber(projects.total),
      by_visibility: asRecord(projects.by_visibility) as Record<string, number>,
      gaps: asArray(projects.gaps).map((g) => {
        const gr = asRecord(g);
        return {
          project: asString(gr.project),
          missing_fields: asArray(gr.missing_fields).map((f) => asString(f)),
        };
      }),
    },
    audit_window: {
      total_entries: asNumber(audit.total_entries),
      by_outcome: asRecord(audit.by_outcome) as Record<string, number>,
      by_workflow: asRecord(audit.by_workflow) as Record<string, number>,
    },
    recent_repo_activity: asArray(r.recent_repo_activity).map(
      parseRepoActivity
    ),
    open_prs: asArray(r.open_prs).map(parseOpenPr),
    recent_issues: asArray(r.recent_issues).map(parseRecentIssue),
    _availability: parseAvailability(r._availability),
  };
}

/** Human label for a brief kind. */
export function kindLabel(kind: string): string {
  if (kind === "morning") {
    return "Morning";
  }
  if (kind === "evening") {
    return "Evening";
  }
  return "Adhoc";
}

/** Compose-latency label, e.g. "3m 12s", from two UTC strings. */
export function composeLatency(
  createdAt: string | null,
  completedAt: string | null
): string | null {
  if (!(createdAt && completedAt)) {
    return null;
  }
  const a = Date.parse(createdAt.replace(" UTC", "Z").replace(" ", "T"));
  const b = Date.parse(completedAt.replace(" UTC", "Z").replace(" ", "T"));
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) {
    return null;
  }
  const secs = Math.round((b - a) / 1000);
  if (secs < 60) {
    return `${secs}s`;
  }
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
}
