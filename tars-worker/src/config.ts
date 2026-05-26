import { hostname } from "node:os";
import { z } from "zod";

const Schema = z.object({
  TARS_APP_DB_URL: z.string().url(),
  ANTHROPIC_API_KEY: z.string().min(20),
  TARS_WORKER_CALLBACK_SECRET: z.string().min(16),

  TARS_WORKER_ID: z.string().min(1).default(`worker-${hostname()}-${process.pid}`),
  TARS_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  TARS_WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
  TARS_WORKER_NOTIFY_DEBOUNCE_MS: z.coerce.number().int().positive().default(100),
  TARS_WORKER_HEARTBEAT_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15_000),
  TARS_WORKER_JOB_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60 * 1000),
  TARS_WORKER_STUCK_JOB_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(30 * 60 * 1000),

  TARS_APP_BASE_URL: z.string().url().default("http://127.0.0.1:3001"),
  TARS_WORKER_CALLBACK_PATH: z.string().default("/api/webhooks/job-done"),

  CODEX_HOME: z.string().default(`${process.env.HOME ?? "/home/shaun"}/.codex`),

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  WORKER_VERSION: z.string().default("0.1.0"),
});

export type Config = z.infer<typeof Schema>;

export function loadConfig(): Config {
  const parsed = Schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n  ");
    throw new Error(`Invalid worker env:\n  ${issues}`);
  }
  return parsed.data;
}

export const callbackUrl = (cfg: Config): string =>
  new URL(cfg.TARS_WORKER_CALLBACK_PATH, cfg.TARS_APP_BASE_URL).toString();
