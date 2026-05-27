import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { workerHeartbeats } from "@/lib/db/worker-schema";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await db
      .select()
      .from(workerHeartbeats)
      .orderBy(desc(workerHeartbeats.lastSeen));

    const now = Date.now();

    return NextResponse.json({
      workers: rows.map((w) => {
        const lastSeenMs = w.lastSeen.getTime();
        const ageSeconds = Math.floor((now - lastSeenMs) / 1000);
        let healthStatus: "green" | "amber" | "red";
        if (ageSeconds < 60) {
          healthStatus = "green";
        } else if (ageSeconds < 300) {
          healthStatus = "amber";
        } else {
          healthStatus = "red";
        }

        return {
          workerId: w.workerId,
          lastSeen: w.lastSeen.toISOString(),
          startedAt: w.startedAt.toISOString(),
          hostname: w.hostname,
          pid: w.pid,
          version: w.version,
          ageSeconds,
          healthStatus,
        };
      }),
    });
  } catch (err) {
    console.error("GET /api/tars/worker/heartbeats error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
