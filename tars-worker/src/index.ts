import { loadConfig } from "./config.js";
import { closeDb, initDb } from "./db.js";
import { Heartbeat } from "./heartbeat.js";
import { initLogger, logger } from "./logger.js";
import { startNotifyListener } from "./queue.js";
import { JobRunner } from "./runner.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  initLogger(cfg);
  logger().info(
    { workerId: cfg.TARS_WORKER_ID, version: cfg.WORKER_VERSION },
    "tars-worker starting",
  );

  initDb(cfg);
  const heartbeat = new Heartbeat(cfg);
  await heartbeat.start();
  logger().info("heartbeat started");

  const runner = new JobRunner(cfg);
  const stopListener = await startNotifyListener(cfg, () => runner.poke());
  await runner.start();
  logger().info("runner started");

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger().info({ signal }, "shutdown signal received");
    try {
      await stopListener();
    } catch (err) {
      logger().warn({ err }, "stopListener error during shutdown");
    }
    try {
      await runner.stop(30_000);
    } catch (err) {
      logger().warn({ err }, "runner.stop error during shutdown");
    }
    try {
      await heartbeat.stop();
    } catch (err) {
      logger().warn({ err }, "heartbeat.stop error during shutdown");
    }
    try {
      await closeDb();
    } catch (err) {
      logger().warn({ err }, "closeDb error during shutdown");
    }
    logger().info("shutdown complete");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("unhandledRejection", (reason) => {
    logger().error({ reason }, "unhandledRejection");
  });
  process.on("uncaughtException", (err) => {
    logger().fatal({ err }, "uncaughtException");
  });
}

main().catch((err) => {
  console.error("fatal startup error", err);
  process.exit(1);
});
