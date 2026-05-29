import { eq, gte, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { prReviewRuns } from "@/lib/db/tars-schema";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const windowParam = req.nextUrl.searchParams.get("window") ?? "7d";
    const days = windowParam === "7d" ? 7 : windowParam === "30d" ? 30 : 7;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [inFlight, pendingApprovalRows, fixActiveRows, recent] =
      await Promise.all([
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(prReviewRuns)
          .where(eq(prReviewRuns.status, "started")),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(prReviewRuns)
          .where(eq(prReviewRuns.status, "pending-approval")),
        // Fix stage active: currently fixing OR a fix PR awaiting human review.
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(prReviewRuns)
          .where(sql`${prReviewRuns.status} in ('fixing', 'fix-in-review')`),
        db
          .select({
            status: prReviewRuns.status,
            createdAt: prReviewRuns.createdAt,
            updatedAt: prReviewRuns.updatedAt,
          })
          .from(prReviewRuns)
          .where(gte(prReviewRuns.createdAt, since)),
      ]);

    const total = recent.length;
    const errors = recent.filter((r) => r.status === "error").length;
    const disagreed = recent.filter((r) => r.status === "disagreed").length;
    // Runs that reached a terminal (review-finished) status. Used only for the
    // mean review-duration metric. `pending-approval`/`approved`/`rejected`
    // are included because the dual-AI review itself is complete by then.
    const completed = recent.filter((r) =>
      [
        "completed",
        "skipped-no-findings",
        "disagreed",
        "pending-approval",
        "approved",
        "rejected",
        "error",
        "blocked-konverge",
        "skipped-policy",
        // Fix-stage statuses also imply the dual-AI review is long done.
        "fixing",
        "fix-in-review",
        "fix-failed",
        "done",
      ].includes(r.status)
    );

    const errorRate = total > 0 ? (errors / total) * 100 : 0;
    const disagreementRate = total > 0 ? (disagreed / total) * 100 : 0;

    let meanReviewMs = 0;
    if (completed.length > 0) {
      const sum = completed.reduce(
        (acc, r) => acc + (r.updatedAt.getTime() - r.createdAt.getTime()),
        0
      );
      meanReviewMs = sum / completed.length;
    }

    return NextResponse.json({
      inFlight: inFlight[0]?.count ?? 0,
      pendingApproval: pendingApprovalRows[0]?.count ?? 0,
      fixActive: fixActiveRows[0]?.count ?? 0,
      errorRate: Math.round(errorRate * 10) / 10,
      disagreementRate: Math.round(disagreementRate * 10) / 10,
      meanReviewMs,
      total,
      windowDays: days,
    });
  } catch (err) {
    console.error("GET /api/tars/dashboard/stats error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
