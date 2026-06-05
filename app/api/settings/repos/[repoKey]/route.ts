import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { repoSettings } from "@/lib/db/tars-schema";
import { deleteTarsHook, ensureTarsHook } from "@/lib/tars/github-hooks";

export const runtime = "nodejs";

const bodySchema = z
  .object({
    webhookEnabled: z.boolean().optional(),
    autoFix: z.boolean().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, {
    message: "No fields to update",
  });

interface RepoUpdate {
  webhookEnabled?: boolean;
  autoFix?: boolean;
  notes?: string | null;
  githubHookId?: number | null;
  updatedAt: Date;
}

/**
 * Persists per-repo review controls (webhook_enabled / auto_fix / notes) to the
 * repo_settings DB table, AND manages the real GitHub webhook: enabling a repo
 * creates (or reuses) the hook and records its id; disabling deletes the hook
 * and clears the id. So the Settings toggle is the true source of truth — no
 * orphaned hooks, and github_hook_id is always accurate.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ repoKey: string }> }
): Promise<NextResponse> {
  const { repoKey: rawKey } = await context.params;
  const repoKey = decodeURIComponent(rawKey);

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 }
    );
  }

  const current = await db
    .select()
    .from(repoSettings)
    .where(eq(repoSettings.repoKey, repoKey))
    .limit(1);
  if (current.length === 0) {
    return NextResponse.json({ error: "Repo not found" }, { status: 404 });
  }
  const cur = current[0];

  const update: RepoUpdate = { updatedAt: new Date() };
  if (parsed.data.webhookEnabled !== undefined) {
    update.webhookEnabled = parsed.data.webhookEnabled;
  }
  if (parsed.data.autoFix !== undefined) {
    update.autoFix = parsed.data.autoFix;
  }
  if (parsed.data.notes !== undefined) {
    update.notes = parsed.data.notes;
  }

  // Manage the real GitHub webhook in lock-step with the enabled flag.
  let hookNote: string | null = null;
  if (parsed.data.webhookEnabled === true) {
    try {
      update.githubHookId = await ensureTarsHook(cur.owner, cur.repo);
    } catch (err) {
      hookNote = `GitHub hook create failed: ${(err as Error).message}`;
    }
  } else if (
    parsed.data.webhookEnabled === false &&
    cur.githubHookId !== null
  ) {
    try {
      await deleteTarsHook(cur.owner, cur.repo, cur.githubHookId);
      update.githubHookId = null;
    } catch (err) {
      hookNote = `GitHub hook delete failed: ${(err as Error).message}`;
    }
  }

  const result = await db
    .update(repoSettings)
    .set(update)
    .where(eq(repoSettings.repoKey, repoKey))
    .returning();

  try {
    revalidatePath("/settings");
  } catch {
    /* no-op outside request context */
  }

  return NextResponse.json({ ok: true, repo: result[0], hookNote });
}
