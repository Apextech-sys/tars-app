import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { webhookEvents } from "@/lib/db/tars-schema";
import { resolvePrRunId } from "@/lib/tars/resolve-pr-run";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const rows = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.id, Number.parseInt(id, 10)))
      .limit(1);

    if (rows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const e = rows[0];
    // `triggered_run` is the WDK execution id (`wrun_…`); the /pr-runs detail
    // route keys on the workflow's own `prrev_…` run_id. Resolve it so the
    // DetailPanel deep-links correctly (or renders plain text when null).
    const resolvedPrRunId = await resolvePrRunId(e);
    return NextResponse.json({
      ...e,
      createdAt: e.createdAt.toISOString(),
      resolvedPrRunId,
    });
  } catch (err) {
    console.error("GET /api/tars/webhooks/[id] error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
