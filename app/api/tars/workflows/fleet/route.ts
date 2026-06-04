import { type NextRequest, NextResponse } from "next/server";
import { getWorkflowOverview } from "@/lib/tars/workflows";

export const dynamic = "force-dynamic";

/**
 * GET /api/tars/workflows/fleet
 *
 * Whole-fleet overview for the /workflows control room: per-workflow live
 * aggregates (from the static registry joined with audit_log + pr_review_runs),
 * the attention buckets (stalled / pending-approval / disagreed), worker +
 * queue health, and windowed throughput. Powers client-side polling so
 * in-flight runs and worker last-seen stay live.
 */
export async function GET(req: NextRequest) {
  try {
    const windowParam = req.nextUrl.searchParams.get("window") ?? "7d";
    const windowDays = windowParam === "30d" ? 30 : 7;
    const overview = await getWorkflowOverview(windowDays);
    return NextResponse.json(overview);
  } catch (err) {
    console.error("GET /api/tars/workflows/fleet error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
