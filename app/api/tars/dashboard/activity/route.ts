import { gte } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { prReviewRuns } from "@/lib/db/tars-schema";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const hoursParam = req.nextUrl.searchParams.get("hours") ?? "24";
    const hours = Math.min(
      Math.max(Number.parseInt(hoursParam, 10) || 24, 1),
      168
    );
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const rows = await db
      .select({
        status: prReviewRuns.status,
        createdAt: prReviewRuns.createdAt,
      })
      .from(prReviewRuns)
      .where(gte(prReviewRuns.createdAt, since));

    // Build hourly buckets
    interface Bucket {
      hour: string;
      completed: number;
      error: number;
      blocked: number;
      disagreed: number;
      started: number;
      skipped: number;
    }

    const buckets = new Map<string, Bucket>();
    const nowMs = Date.now();

    for (let i = hours - 1; i >= 0; i--) {
      const d = new Date(nowMs - i * 60 * 60 * 1000);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}T${String(d.getUTCHours()).padStart(2, "0")}:00Z`;
      buckets.set(key, {
        hour: key,
        completed: 0,
        error: 0,
        blocked: 0,
        disagreed: 0,
        started: 0,
        skipped: 0,
      });
    }

    for (const row of rows) {
      const d = row.createdAt;
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}T${String(d.getUTCHours()).padStart(2, "0")}:00Z`;
      const bucket = buckets.get(key);
      if (!bucket) {
        continue;
      }

      if (row.status === "completed") {
        bucket.completed++;
      } else if (row.status === "error") {
        bucket.error++;
      } else if (row.status === "blocked-konverge") {
        bucket.blocked++;
      } else if (row.status === "disagreed") {
        bucket.disagreed++;
      } else if (row.status === "started") {
        bucket.started++;
      } else {
        bucket.skipped++;
      }
    }

    return NextResponse.json({
      buckets: Array.from(buckets.values()),
      hours,
    });
  } catch (err) {
    console.error("GET /api/tars/dashboard/activity error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
