import { setTimeout as sleep } from "node:timers/promises";
import { postCallback } from "./callback.js";
import type { Config } from "./config.js";
import { getHandler } from "./handlers/index.js";
import { logger } from "./logger.js";
import {
  claimNextJob,
  markDone,
  markFailed,
  reclaimStuckJobs,
  updateJobSession,
} from "./queue.js";
import type { HandlerContext, JobRow } from "./types.js";

export class JobRunner {
  private readonly cfg: Config;
  private inFlight = 0;
  private stopping = false;
  private wakeUp?: () => void;

  constructor(cfg: Config) {
    this.cfg = cfg;
  }

  async start(): Promise<void> {
    await reclaimStuckJobs(this.cfg);
    // loop() is intentionally fire-and-forget; it's a long-running background
    // task whose lifetime is bound to the worker process. The .catch() exists
    // so an unexpected throw is visible in logs rather than swallowed.
    this.loop().catch((err) => {
      logger().error({ err }, "runner loop threw");
    });
  }

  poke(): void {
    if (this.wakeUp) {
      this.wakeUp();
    }
  }

  async stop(graceMs = 30_000): Promise<void> {
    this.stopping = true;
    this.poke();
    const deadline = Date.now() + graceMs;
    while (this.inFlight > 0 && Date.now() < deadline) {
      await sleep(250);
    }
    if (this.inFlight > 0) {
      logger().warn(
        { inFlight: this.inFlight },
        "stop() grace period elapsed with jobs still running"
      );
    }
  }

  private async loop(): Promise<void> {
    while (!this.stopping) {
      while (
        !this.stopping &&
        this.inFlight < this.cfg.TARS_WORKER_CONCURRENCY
      ) {
        const job = await claimNextJob(this.cfg.TARS_WORKER_ID).catch((err) => {
          logger().error({ err }, "claimNextJob threw");
          return null;
        });
        if (!job) {
          break;
        }
        this.inFlight++;
        this.processJob(job)
          .catch((err) => {
            logger().error({ err, jobId: job.id }, "processJob threw");
          })
          .finally(() => {
            this.inFlight--;
            this.poke();
          });
      }
      if (this.stopping) {
        break;
      }
      await this.waitForWork();
    }
  }

  private waitForWork(): Promise<void> {
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(t);
        this.wakeUp = undefined;
        resolve();
      };
      this.wakeUp = finish;
      const t = setTimeout(finish, this.cfg.TARS_WORKER_POLL_INTERVAL_MS);
      t.unref?.();
    });
  }

  private async processJob(job: JobRow): Promise<void> {
    const log = (msg: string, fields?: Record<string, unknown>): void => {
      logger().info({ jobId: job.id, kind: job.kind, ...fields }, msg);
    };

    const handler = getHandler(job.kind);
    if (!handler) {
      log("no handler — failing job");
      await markFailed(job.id, `no handler for kind '${job.kind}'`, {
        allowRetry: false,
      });
      await this.fireCallback(job, {
        status: "failed",
        errorText: `no handler for kind '${job.kind}'`,
      });
      return;
    }

    const ac = new AbortController();
    const timeout = setTimeout(() => {
      log("job timeout — aborting");
      ac.abort();
    }, this.cfg.TARS_WORKER_JOB_TIMEOUT_MS);
    timeout.unref?.();

    const ctx: HandlerContext = {
      job,
      signal: ac.signal,
      updateSessionId: async (sessionId: string) => {
        try {
          await updateJobSession(job.id, sessionId);
        } catch (err) {
          logger().warn(
            { err, jobId: job.id, sessionId },
            "updateJobSession failed"
          );
        }
      },
      log,
    };

    try {
      log("running");
      const result = await handler(ctx);
      await markDone(job.id, result);
      log("done");
      await this.fireCallback(job, { status: "done", result });
    } catch (err) {
      const errorText =
        err instanceof Error ? (err.stack ?? err.message) : String(err);
      log("failed", { errorText });
      const { requeued } = await markFailed(job.id, errorText, {
        allowRetry: !ac.signal.aborted,
      });
      if (requeued) {
        log("requeued for retry");
      } else {
        await this.fireCallback(job, {
          status: "failed",
          errorText,
        });
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fireCallback(
    job: JobRow,
    body: { status: "done" | "failed"; result?: unknown; errorText?: string }
  ): Promise<void> {
    try {
      await postCallback(this.cfg, job, {
        jobId: job.id,
        kind: job.kind,
        status: body.status,
        result: body.result,
        errorText: body.errorText ?? null,
        sessionId: job.sessionId ?? null,
        attempts: job.attempts,
        workerId: this.cfg.TARS_WORKER_ID,
        completedAt: new Date().toISOString(),
      });
    } catch (err) {
      logger().error({ err, jobId: job.id }, "fireCallback threw");
    }
  }
}
