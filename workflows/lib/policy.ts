/**
 * Project policy resolution from /home/shaun/.tars-state/knowledge/projects.yaml.
 *
 * Marked `"use step"`; `fs` + `yaml` are lazy-imported inside the step.
 *
 * Slice 1 (2026-05-28): protect_mode is RETIRED. Review now runs on ALL
 * `auto_review: true` repos — including the Konverge / Reflex-Connect repos
 * that were previously short-circuited to `blocked-konverge`. The human
 * approval gate (status `pending-approval` + the dashboard Approve/Reject
 * panel) replaces protect_mode as the safety boundary: nothing is written to
 * an external system (GitHub / a fix branch) until Shaun approves. As a
 * result `ResolvedPolicy` no longer carries a `protectMode` field and this
 * resolver no longer derives one from `business`/`partners`/`projectKey`.
 *
 * `issueTracker` + `linearTeam` are now read straight from the matched
 * project's `issue_tracker` / `linear_team` fields (previously hard-coded to
 * `"none"`), so Konverge/REF repos correctly resolve `issueTracker: "linear"`
 * + `linearTeam: "REF"` and the Linear lifecycle can run.
 *
 * `autoFix` + `severityThreshold` are likewise read from the per-project
 * `auto_fix` / `severity_threshold` fields rather than special-casing
 * individual project keys, so projects.yaml is the single source of truth.
 */

import type { Severity } from "./schemas";

export interface ResolvedPolicy {
  projectKey: string | null;
  matched: boolean;
  autoReview: boolean;
  autoFix: boolean;
  severityThreshold: Severity;
  issueTracker: "linear" | "github" | "none";
  /** Linear team key (e.g. "REF") when issueTracker === "linear"; else null. */
  linearTeam: string | null;
  slackNotify: boolean;
  slackChannel: string | null;
  rawProject: Record<string, unknown> | null;
}

function projectsYamlPath(): string {
  return (
    process.env.TARS_PROJECTS_YAML_PATH ??
    "/home/shaun/.tars-state/knowledge/projects.yaml"
  );
}

// Cache keyed by absolute path + mtime so test environments switching the
// path env var don't get stale data.
const cache = new Map<
  string,
  { mtime: number; data: Record<string, Record<string, unknown>> }
>();

async function loadProjects(): Promise<
  Record<string, Record<string, unknown>>
> {
  const fs = await import("node:fs");
  const YAML = await import("yaml");
  const yamlPath = projectsYamlPath();
  try {
    const stat = fs.statSync(yamlPath);
    const cached = cache.get(yamlPath);
    if (cached && cached.mtime === stat.mtimeMs) {
      return cached.data;
    }
    const raw = fs.readFileSync(yamlPath, "utf8");
    const parsed = (YAML.parse(raw) ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
    cache.set(yamlPath, { mtime: stat.mtimeMs, data: parsed });
    return parsed;
  } catch (err) {
    if (process.env.TARS_DEBUG_POLICY) {
      console.warn(
        `[policy] failed to read ${yamlPath}: ${(err as Error).message}`
      );
    }
    return {};
  }
}

const VALID_SEVERITIES: ReadonlySet<string> = new Set([
  "critical",
  "major",
  "minor",
  "nit",
]);

function normalizeSeverity(value: unknown, fallback: Severity): Severity {
  if (typeof value === "string" && VALID_SEVERITIES.has(value)) {
    return value as Severity;
  }
  return fallback;
}

function normalizeIssueTracker(value: unknown): "linear" | "github" | "none" {
  if (typeof value !== "string") {
    return "none";
  }
  const v = value.toLowerCase();
  if (v === "linear") {
    return "linear";
  }
  if (v === "github" || v === "github_issues") {
    return "github";
  }
  return "none";
}

/**
 * Resolve the policy for a given repo (owner/repo).
 *
 * Marked `"use step"`. The workflow calls this once at the top of the
 * pipeline and the result becomes a regular serializable value.
 */
export async function resolvePolicy(
  owner: string,
  repo: string
): Promise<ResolvedPolicy> {
  "use step";
  const fullName = `${owner}/${repo}`.toLowerCase();
  const projects = await loadProjects();

  let matchedKey: string | null = null;
  let matchedProject: Record<string, unknown> | null = null;
  for (const [key, project] of Object.entries(projects)) {
    if (!project || typeof project !== "object") {
      continue;
    }
    const repos = (project as { repos?: unknown }).repos;
    if (!Array.isArray(repos)) {
      continue;
    }
    for (const r of repos) {
      if (typeof r === "string" && r.toLowerCase() === fullName) {
        matchedKey = key;
        matchedProject = project as Record<string, unknown>;
        break;
      }
    }
    if (matchedKey) {
      break;
    }
  }

  if (!matchedProject) {
    return {
      projectKey: null,
      matched: false,
      autoReview: true,
      autoFix: false,
      severityThreshold: "minor",
      issueTracker: "none",
      linearTeam: null,
      slackNotify: false,
      slackChannel: null,
      rawProject: null,
    };
  }

  const slackChannelRaw =
    typeof matchedProject.slack === "string" ? matchedProject.slack : "";

  const issueTracker = normalizeIssueTracker(matchedProject.issue_tracker);
  const linearTeam =
    issueTracker === "linear" && typeof matchedProject.linear_team === "string"
      ? (matchedProject.linear_team as string)
      : null;

  // `auto_review` defaults to true when omitted; an explicit `false` disables
  // review for the repo (still honored — that gate is unrelated to protect_mode).
  const autoReview = matchedProject.auto_review !== false;
  const autoFix = matchedProject.auto_fix === true;

  return {
    projectKey: matchedKey,
    matched: true,
    autoReview,
    autoFix,
    severityThreshold: normalizeSeverity(
      matchedProject.severity_threshold,
      "minor"
    ),
    issueTracker,
    linearTeam,
    slackNotify: Boolean(slackChannelRaw),
    slackChannel: slackChannelRaw || null,
    rawProject: matchedProject,
  };
}

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  major: 1,
  minor: 2,
  nit: 3,
};

// Pure helper, safe to call from workflow code (no I/O).
export function severityAtLeast(
  actual: Severity,
  threshold: Severity
): boolean {
  return SEVERITY_ORDER[actual] <= SEVERITY_ORDER[threshold];
}
