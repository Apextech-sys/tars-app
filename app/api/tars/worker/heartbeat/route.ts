import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { workerHeartbeats } from "@/lib/db/worker-schema";

const bodySchema = z.object({
  workerId: z.string().min(1),
  hostname: z.string().optional(),
  pid: z.number().int().optional(),
  version: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const raw = await req.json();
    const data = bodySchema.parse(raw);

    await db
      .insert(workerHeartbeats)
      .values({
        workerId: data.workerId,
        lastSeen: new Date(),
        startedAt: new Date(),
        hostname: data.hostname ?? null,
        pid: data.pid ?? null,
        version: data.version ?? null,
      })
      .onConflictDoUpdate({
        target: workerHeartbeats.workerId,
        set: {
          lastSeen: new Date(),
          hostname: data.hostname ?? null,
          pid: data.pid ?? null,
          version: data.version ?? null,
        },
      });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", issues: err.issues },
        { status: 400 }
      );
    }
    console.error("POST /api/tars/worker/heartbeat error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
