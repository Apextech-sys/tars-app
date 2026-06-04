import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { repoSettings } from "@/lib/db/tars-schema";

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

/**
 * Persists per-repo review controls (webhook_enabled / auto_fix / notes) to the
 * repo_settings DB table — replacing the dead projects.yaml file writes.
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

  const update: {
    webhookEnabled?: boolean;
    autoFix?: boolean;
    notes?: string | null;
    updatedAt: Date;
  } = { updatedAt: new Date() };
  if (parsed.data.webhookEnabled !== undefined) {
    update.webhookEnabled = parsed.data.webhookEnabled;
  }
  if (parsed.data.autoFix !== undefined) {
    update.autoFix = parsed.data.autoFix;
  }
  if (parsed.data.notes !== undefined) {
    update.notes = parsed.data.notes;
  }

  const result = await db
    .update(repoSettings)
    .set(update)
    .where(eq(repoSettings.repoKey, repoKey))
    .returning();

  if (result.length === 0) {
    return NextResponse.json({ error: "Repo not found" }, { status: 404 });
  }

  try {
    revalidatePath("/settings");
  } catch {
    /* no-op outside request context */
  }

  return NextResponse.json({ ok: true, repo: result[0] });
}
