import { type NextRequest, NextResponse } from "next/server";
import { getRunTimeline } from "@/lib/tars/workflows";

export const dynamic = "force-dynamic";

/**
 * GET /api/tars/workflows/run/[runId]
 *
 * Generalised single-run durable timeline: the run row + its ordered audit_log
 * steps (collapsed to start/end with per-step durations) + the dispatched
 * tars_jobs. Shapes any workflow's audit trail uniformly for the run-timeline
 * component.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;
    const timeline = await getRunTimeline(runId);
    if (!timeline) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }
    return NextResponse.json(timeline);
  } catch (err) {
    console.error("GET /api/tars/workflows/run/[runId] error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
