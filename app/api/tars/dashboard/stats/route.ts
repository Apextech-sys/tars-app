import { and, eq, gte, lte, or, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { prReviewRuns } from "@/lib/db/tars-schema";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const windowParam = req.nextUrl.searchParams.get("window") ?? "7d";
    const days = windowParam === "7d" ? 7 : windowParam === "30d" ? 30 : 7;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [inFlight, recent] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(prReviewRuns)
        .where(eq(prReviewRuns.status, "started")),
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
    const completed = recent.filter((r) =>
      ["completed", "skipped-no-findings", "disagreed", "error", "blocked-konverge", "skipped-policy"].includes(r.status)
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
      errorRate: Math.round(errorRate * 10) / 10,
      disagreementRate: Math.round(disagreementRate * 10) / 10,
      meanReviewMs,
      total,
      windowDays: days,
    });
  } catch (err) {
    console.error("GET /api/tars/dashboard/stats error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
