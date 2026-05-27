import { and, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { prReviewRuns } from "@/lib/db/tars-schema";

const bodySchema = z.object({
  runId: z.string().min(1),
  action: z.enum(["post-codex", "post-claude", "post-merged", "dismiss"]),
});

export async function POST(req: NextRequest) {
  try {
    const raw = await req.json();
    const { runId, action } = bodySchema.parse(raw);

    // Verify run exists and is disagreed
    const rows = await db
      .select({ runId: prReviewRuns.runId, status: prReviewRuns.status })
      .from(prReviewRuns)
      .where(eq(prReviewRuns.runId, runId))
      .limit(1);

    if (rows.length === 0) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    if (rows[0].status !== "disagreed") {
      return NextResponse.json(
        { error: "Run is not in disagreed state" },
        { status: 409 }
      );
    }

    // Persist the adjudication choice
    await db
      .update(prReviewRuns)
      .set({
        adjudicationAction: action,
        adjudicationActionAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(prReviewRuns.runId, runId));

    // TODO (next slice): actually post to GitHub using the Octokit client
    // For now: action is recorded, toast is shown client-side.

    return NextResponse.json({ ok: true, runId, action });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", issues: err.issues },
        { status: 400 }
      );
    }
    console.error("POST /api/tars/pr-review/disagreement-action error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
