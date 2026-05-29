import { desc, gte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { workerHeartbeats } from "@/lib/db/worker-schema";

export const dynamic = "force-dynamic";

// Regex used to detect legacy worker-<hostname>-<pid> id format (top-level for perf).
const LEGACY_WORKER_ID_RE = /^worker-[^-]+-\d+$/;

export async function GET() {
  try {
    // Only return LIVE workers: last_seen within 2 minutes (120 s).
    // Stale historical rows (from previous PIDs) are excluded here so the
    // dashboard Worker Status card shows an accurate headcount.
    const LIVE_WINDOW_S = 120;
    const liveThreshold = new Date(Date.now() - LIVE_WINDOW_S * 1000);

    const rows = await db
      .select()
      .from(workerHeartbeats)
      .where(gte(workerHeartbeats.lastSeen, liveThreshold))
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

        // Display a clean name: strip the legacy "worker-<hostname>-<pid>" prefix
        // if present; fall back to the raw workerId. New registrations use the
        // stable "tars-worker" id so this is mainly for transition hygiene.
        let displayName: string;
        if (w.workerId.startsWith("tars-")) {
          displayName = w.workerId;
        } else if (LEGACY_WORKER_ID_RE.test(w.workerId)) {
          displayName = "tars-worker";
        } else {
          displayName = w.workerId;
        }

        return {
          workerId: displayName,
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
