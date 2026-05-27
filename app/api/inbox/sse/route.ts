import { NextResponse } from "next/server";
import postgres from "postgres";

const connectionString =
  process.env.DATABASE_URL || "postgres://localhost:5432/workflow";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const encoder = new TextEncoder();
  const abort = request.signal;

  const stream = new ReadableStream({
    async start(controller) {
      const listenClient = postgres(connectionString, { max: 1 });
      let closed = false;

      const send = (data: unknown) => {
        if (closed) {
          return;
        }
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // client disconnected
          closed = true;
        }
      };

      // Cleanup helper
      const cleanup = async () => {
        closed = true;
        clearInterval(heartbeat);
        try {
          await listenClient.end({ timeout: 2 });
        } catch {
          // ignore
        }
        try {
          controller.close();
        } catch {
          // ignore if already closed
        }
      };

      // Wire abort signal
      abort.addEventListener("abort", () => {
        void cleanup();
      });

      send({ type: "connected" });
      const heartbeat = setInterval(() => send({ type: "ping" }), 25_000);

      try {
        await listenClient.listen("escalations_change", (payload) => {
          send({ type: "escalation_changed", payload });
        });

        // Keep alive until abort
        await new Promise<void>((resolve) => {
          abort.addEventListener("abort", () => resolve(), { once: true });
        });
      } finally {
        await cleanup();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
