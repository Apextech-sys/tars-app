import { createHmac, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { closeDb, initDb } from "../../src/db.js";
import { initLogger } from "../../src/logger.js";
import { startNotifyListener } from "../../src/queue.js";
import { JobRunner } from "../../src/runner.js";
import { cleanJobs, getTestPool } from "../setup.js";

interface CallbackCapture {
  body: unknown;
  signature: string | undefined;
  jobId: string | undefined;
  rawBody: string;
}

describe("no-op job round-trip", () => {
  let server: Server;
  let port = 0;
  let captured: CallbackCapture[] = [];

  beforeEach(async () => {
    await cleanJobs();
    captured = [];
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => {
        raw += String(c);
      });
      req.on("end", () => {
        try {
          captured.push({
            rawBody: raw,
            body: raw ? JSON.parse(raw) : null,
            signature: req.headers["x-tars-signature"] as string | undefined,
            jobId: req.headers["x-tars-job-id"] as string | undefined,
          });
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(500);
          res.end(String(e));
        }
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          port = addr.port;
        }
        resolve();
      });
    });
  });

  afterEach(async () => {
    server.close();
    await closeDb();
  });

  it("dispatches a no-op job, picks it up, fires HMAC-signed callback", async () => {
    process.env.TARS_APP_BASE_URL = `http://127.0.0.1:${port}`;
    process.env.TARS_WORKER_POLL_INTERVAL_MS = "200";
    process.env.TARS_WORKER_CONCURRENCY = "1";
    process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "warn";

    const cfg = loadConfig();
    initLogger(cfg);
    initDb(cfg);

    const runner = new JobRunner(cfg);
    const stopListener = await startNotifyListener(cfg, () => runner.poke());
    await runner.start();

    const id = randomUUID();
    await getTestPool().query(
      "INSERT INTO tars_jobs (id, kind, payload, status) VALUES ($1,'no-op',$2::jsonb,'queued')",
      [id, JSON.stringify({ sleepMs: 200, message: "round-trip" })]
    );

    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (captured.find((c) => c.jobId === id)) {
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    const cb = captured.find((c) => c.jobId === id);
    expect(cb).toBeDefined();
    if (!cb) {
      throw new Error("callback for job was not captured");
    }

    const expectedSig = createHmac("sha256", cfg.TARS_WORKER_CALLBACK_SECRET)
      .update(cb.rawBody)
      .digest("hex");
    expect(cb.signature).toBe(expectedSig);

    const body = cb.body as {
      jobId: string;
      kind: string;
      status: string;
      result: { echo: { message: string }; ts: string; jobId: string };
    };
    expect(body.jobId).toBe(id);
    expect(body.kind).toBe("no-op");
    expect(body.status).toBe("done");
    expect(body.result.echo.message).toBe("round-trip");
    expect(typeof body.result.ts).toBe("string");
    expect(body.result.jobId).toBe(id);

    const row = await getTestPool().query<{ status: string }>(
      "SELECT status FROM tars_jobs WHERE id = $1",
      [id]
    );
    expect(row.rows[0].status).toBe("done");

    await runner.stop(5000);
    await stopListener();
  });
});
