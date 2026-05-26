/**
 * Project policy resolution from /home/shaun/.tars-state/knowledge/projects.yaml.
 *
 * Marked `"use step"`; `fs` + `yaml` are lazy-imported inside the step.
 *
 * Konverge protect mode is hard-coded business rule (see konverge-guard.ts).
 */

import type { Severity } from "./schemas";

export interface ResolvedPolicy {
  projectKey: string | null;
  matched: boolean;
  autoReview: boolean;
  autoFix: boolean;
  severityThreshold: Severity;
  issueTracker: "linear" | "github" | "none";
  slackNotify: boolean;
  slackChannel: string | null;
  protectMode: boolean;
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

async function loadProjects(): Promise<Record<string, Record<string, unknown>>> {
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
      slackNotify: false,
      slackChannel: null,
      protectMode: false,
      rawProject: null,
    };
  }

  const partners = Array.isArray(matchedProject.partners)
    ? (matchedProject.partners as string[]).map((p) => p.toLowerCase())
    : [];
  const businessCode = (
    typeof matchedProject.business === "string" ? matchedProject.business : ""
  ).toLowerCase();
  const projectKeyLower = matchedKey?.toLowerCase() ?? "";

  const protectMode =
    businessCode === "konverge" ||
    projectKeyLower === "konverge" ||
    partners.includes("konverge");

  const isPolymarketV2 =
    projectKeyLower === "polymarket-v2" || projectKeyLower === "polymarketv2";

  const slackChannelRaw =
    typeof matchedProject.slack === "string" ? matchedProject.slack : "";

  if (protectMode) {
    return {
      projectKey: matchedKey,
      matched: true,
      autoReview: true,
      autoFix: false,
      severityThreshold: "major",
      issueTracker: "none",
      slackNotify: false,
      slackChannel: null,
      protectMode: true,
      rawProject: matchedProject,
    };
  }

  return {
    projectKey: matchedKey,
    matched: true,
    autoReview: true,
    autoFix: !isPolymarketV2,
    severityThreshold: isPolymarketV2 ? "major" : "minor",
    issueTracker: "none",
    slackNotify: Boolean(slackChannelRaw),
    slackChannel: slackChannelRaw || null,
    protectMode: false,
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
export function severityAtLeast(actual: Severity, threshold: Severity): boolean {
  return SEVERITY_ORDER[actual] <= SEVERITY_ORDER[threshold];
}
