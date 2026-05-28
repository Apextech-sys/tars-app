"use server";

import { readFileSync, writeFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import YAML from "yaml";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/tars-schema";

function getProjectsYamlPath(): string {
  return (
    process.env.TARS_PROJECTS_YAML_PATH ??
    "/home/shaun/.tars-state/knowledge/projects.yaml"
  );
}

// ---------- YAML policy ----------

export interface ProjectPolicy {
  kind?: string;
  visibility?: string;
  business?: string;
  description?: string;
  repos?: string[];
  auto_review?: boolean;
  auto_fix?: boolean;
  protect_mode?: boolean;
  [key: string]: unknown;
}

export type ProjectsMap = Record<string, ProjectPolicy>;

// Simple cache to avoid re-reading on every hot render
let _cache: { mtime: number; data: ProjectsMap } | null = null;

export async function invalidateCache() {
  _cache = null;
}

export async function loadProjectsYaml(): Promise<{
  raw: string;
  parsed: ProjectsMap;
}> {
  const { statSync } = await import("node:fs");
  try {
    const stat = statSync(getProjectsYamlPath());
    if (_cache && _cache.mtime === stat.mtimeMs) {
      return { raw: YAML.stringify(_cache.data), parsed: _cache.data };
    }
    const raw = readFileSync(getProjectsYamlPath(), "utf8");
    const parsed = (YAML.parse(raw) ?? {}) as ProjectsMap;
    _cache = { mtime: stat.mtimeMs, data: parsed };
    return { raw, parsed };
  } catch {
    return { raw: "# projects.yaml not found", parsed: {} };
  }
}

export async function saveProjectsYaml(
  yamlText: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  let parsed: ProjectsMap;
  try {
    parsed = (YAML.parse(yamlText) ?? {}) as ProjectsMap;
  } catch (e) {
    return { ok: false, error: `Invalid YAML: ${(e as Error).message}` };
  }

  // Validate it's an object, not an array/primitive
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "YAML root must be a mapping of project keys." };
  }

  // protect_mode is RETIRED (Slice 1). We no longer force-write
  // `konverge.protect_mode = true`; the human approval gate is the safety
  // boundary now, so the YAML field carries no meaning and edits pass through.

  try {
    writeFileSync(getProjectsYamlPath(), YAML.stringify(parsed), "utf8");
    invalidateCache();
    try {
      revalidatePath("/settings");
    } catch {
      /* no-op outside request context */
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Write failed: ${(e as Error).message}` };
  }
}

// ---------- Kill switches ----------

export async function saveKillSwitches(
  changes: Record<string, { auto_review?: boolean; auto_fix?: boolean }>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { parsed } = await loadProjectsYaml();

  for (const [key, vals] of Object.entries(changes)) {
    if (!parsed[key]) {
      continue;
    }
    if (vals.auto_review !== undefined) {
      parsed[key].auto_review = vals.auto_review;
    }
    if (vals.auto_fix !== undefined) {
      parsed[key].auto_fix = vals.auto_fix;
    }
  }

  return saveProjectsYaml(YAML.stringify(parsed));
}

// ---------- Model picker ----------

export async function loadModelSettings(): Promise<{
  chatModel: string;
  codeReviewModel: string;
}> {
  const rows = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, "chat_model"));
  const crRows = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, "code_review_model"));

  const chatModel =
    (rows[0]?.value as string | undefined) ?? "claude-sonnet-4-5";
  const codeReviewModel =
    (crRows[0]?.value as string | undefined) ?? "claude-sonnet-4-5";

  return { chatModel, codeReviewModel };
}

export async function saveModelSettings(settings: {
  chatModel: string;
  codeReviewModel: string;
}): Promise<void> {
  await db
    .insert(appSettings)
    .values([
      { key: "chat_model", value: settings.chatModel },
      { key: "code_review_model", value: settings.codeReviewModel },
    ])
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: sql`EXCLUDED.value`, updatedAt: new Date() },
    });
  try {
    revalidatePath("/settings");
  } catch {
    /* no-op outside request context */
  }
}
