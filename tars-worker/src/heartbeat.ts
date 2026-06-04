import { hostname } from "node:os";
import type { Config } from "./config.js";
import { getPool } from "./db.js";
import { logger } from "./logger.js";

export class Heartbeat {
  private timer?: NodeJS.Timeout;
  private readonly cfg: Config;

  constructor(cfg: Config) {
    this.cfg = cfg;
  }

  async start(): Promise<void> {
    // Prune any heartbeat rows that don't match the current stable worker_id
    // (e.g. legacy `worker-<hostname>-<pid>` rows from before the stable-ID fix,
    // or rows left by a future worker_id format change). Keeps the table to just
    // the live worker across restarts without manual intervention. Non-fatal.
    await this.prune().catch((err) => {
      logger().warn({ err }, "heartbeat startup prune failed");
    });
    await this.write();
    this.timer = setInterval(() => {
      this.write().catch((err) => {
        logger().error({ err }, "heartbeat write failed");
      });
    }, this.cfg.TARS_WORKER_HEARTBEAT_INTERVAL_MS);
    this.timer.unref?.();
  }

  // biome-ignore lint/suspicious/useAwait: keeps a Promise-returning contract symmetric with start(); callers await stop()
  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async prune(): Promise<void> {
    const pool = getPool();
    await pool.query("DELETE FROM worker_heartbeats WHERE worker_id <> $1", [
      this.cfg.TARS_WORKER_ID,
    ]);
  }

  private async write(): Promise<void> {
    const sql = `
      INSERT INTO worker_heartbeats (worker_id, last_seen, started_at, hostname, pid, version)
      VALUES ($1, now(), now(), $2, $3, $4)
      ON CONFLICT (worker_id) DO UPDATE
        SET last_seen = now(),
            hostname  = EXCLUDED.hostname,
            pid       = EXCLUDED.pid,
            version   = EXCLUDED.version
    `;
    const pool = getPool();
    await pool.query(sql, [
      this.cfg.TARS_WORKER_ID,
      hostname(),
      process.pid,
      this.cfg.WORKER_VERSION,
    ]);
  }
}
