import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { tarsJobs } from "@/lib/db/worker-schema";
import { verifyCallbackSignature } from "@/lib/tars-worker/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.TARS_WORKER_CALLBACK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "TARS_WORKER_CALLBACK_SECRET not configured" },
      { status: 500 }
    );
  }

  const signature = req.headers.get("x-tars-signature");
  if (!signature) {
    return NextResponse.json(
      { error: "missing x-tars-signature header" },
      { status: 401 }
    );
  }

  const rawBody = await req.text();
  if (!verifyCallbackSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let body: {
    jobId: string;
    kind: string;
    status: "done" | "failed";
    result?: unknown;
    errorText?: string | null;
    sessionId?: string | null;
    attempts: number;
    workerId: string;
    completedAt: string;
  };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!(body.jobId && body.status)) {
    return NextResponse.json(
      { error: "missing jobId or status in body" },
      { status: 400 }
    );
  }

  const rows = await db
    .select({
      id: tarsJobs.id,
      status: tarsJobs.status,
      kind: tarsJobs.kind,
    })
    .from(tarsJobs)
    .where(eq(tarsJobs.id, body.jobId))
    .limit(1);

  if (rows.length === 0) {
    return NextResponse.json(
      { ok: false, reason: "job not found", jobId: body.jobId },
      { status: 404 }
    );
  }

  // Best-effort resume of any waiting WDK workflow. We deliberately suppress
  // the loader error: turbopack-built routes cannot dynamic-import the
  // workspace workflow package from inside the route, so we silently degrade
  // to "no waiter to resume" which is fine for jobs dispatched without a
  // workflow (the queue + status row already captures the result).
  try {
    const mod = await import("workflow").catch(() => null);
    const sendEvent = (
      mod as unknown as {
        sendEvent?: (name: string, payload: unknown) => Promise<void>;
      } | null
    )?.sendEvent;
    if (typeof sendEvent === "function") {
      await sendEvent(`job:${body.jobId}:done`, body);
    }
  } catch {
    // intentionally silent — webhook is best-effort wrt workflow resume.
  }

  return NextResponse.json({ ok: true, jobId: body.jobId });
}
