import { gte } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { prReviewRuns } from "@/lib/db/tars-schema";

export const dynamic = "force-dynamic";

interface ActivityBucket {
  hour: string;
  completed: number;
  error: number;
  blocked: number;
  disagreed: number;
  started: number;
  skipped: number;
}

// Map a run status to the numeric Bucket field it increments. Any status not
// listed here falls back to "skipped" (matching the original else branch).
const STATUS_TO_BUCKET_FIELD: Record<
  string,
  Exclude<keyof ActivityBucket, "hour">
> = {
  completed: "completed",
  error: "error",
  "blocked-konverge": "blocked",
  disagreed: "disagreed",
  started: "started",
};

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
    const buckets = new Map<string, ActivityBucket>();
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

      const field = STATUS_TO_BUCKET_FIELD[row.status ?? ""] ?? "skipped";
      bucket[field]++;
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
