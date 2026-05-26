import { pino } from "pino";
import type { Config } from "./config.js";

let _logger: ReturnType<typeof pino> | undefined;

export function initLogger(cfg: Config): ReturnType<typeof pino> {
  _logger = pino({
    level: cfg.LOG_LEVEL,
    base: {
      worker_id: cfg.TARS_WORKER_ID,
      version: cfg.WORKER_VERSION,
    },
    redact: {
      paths: [
        "*.ANTHROPIC_API_KEY",
        "*.TARS_WORKER_CALLBACK_SECRET",
        "*.TARS_APP_DB_URL",
        "*.callback_signed_token",
      ],
      censor: "[redacted]",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
  return _logger;
}

export function logger(): ReturnType<typeof pino> {
  if (!_logger) {
    _logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
  }
  return _logger;
}
