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
    await this.write();
    this.timer = setInterval(() => {
      this.write().catch((err) => {
        logger().error({ err }, "heartbeat write failed");
      });
    }, this.cfg.TARS_WORKER_HEARTBEAT_INTERVAL_MS);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
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
