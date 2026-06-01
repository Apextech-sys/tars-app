import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const Schema = z.object({
  TARS_APP_DB_URL: z.string().url(),
  // ANTHROPIC_API_KEY is intentionally NOT required here.
  // Auth for the Claude Agent SDK is via Shaun's Claude Max OAuth credential.
  // The SDK reads ~/.claude/.credentials.json automatically when ANTHROPIC_API_KEY
  // is absent. See memory/claude-agent-sdk-billing.md — this is a locked decision.
  // Setting ANTHROPIC_API_KEY would force expensive PAYG billing and bypass the
  // subscription pool.  If you need to override for a specific environment, set
  // ANTHROPIC_API_KEY in that environment's config — but do NOT set it here by
  // default.
  //
  // CLAUDE_CODE_OAUTH_TOKEN can be set as an alternative non-interactive path.
  CLAUDE_CODE_OAUTH_TOKEN: z.string().optional(),

  TARS_WORKER_CALLBACK_SECRET: z.string().min(16),

  TARS_WORKER_ID: z.string().min(1).default("tars-worker"),
  TARS_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  TARS_WORKER_POLL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(5000),
  TARS_WORKER_NOTIFY_DEBOUNCE_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(100),
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

/**
 * Check that at least one Claude auth path is available at startup.
 * This is a soft-boot check, not a hard failure — the SDK will produce a
 * more descriptive error if auth is truly absent when a job runs.
 */
function warnIfNoClaudeAuth(): void {
  const hasApiKey =
    typeof process.env.ANTHROPIC_API_KEY === "string" &&
    process.env.ANTHROPIC_API_KEY.length >= 20;
  const hasOauthToken =
    typeof process.env.CLAUDE_CODE_OAUTH_TOKEN === "string" &&
    process.env.CLAUDE_CODE_OAUTH_TOKEN.length > 0;
  const homeDir = process.env.HOME ?? "/home/shaun";
  const credPaths = [
    join(homeDir, ".claude", ".credentials.json"),
    join(homeDir, ".claude", "credentials.json"),
  ];
  const hasCredFile = credPaths.some((p) => {
    try {
      return existsSync(p);
    } catch {
      return false;
    }
  });

  if (!(hasApiKey || hasOauthToken || hasCredFile)) {
    console.warn(
      "[tars-worker] WARNING: no Claude auth found. " +
        "Set CLAUDE_CODE_OAUTH_TOKEN, mount ~/.claude/.credentials.json, " +
        "or (not preferred) set ANTHROPIC_API_KEY. " +
        "Claude agent jobs will fail until auth is available."
    );
  } else if (hasApiKey) {
    console.warn(
      "[tars-worker] WARNING: ANTHROPIC_API_KEY is set — this forces PAYG billing " +
        "and bypasses the Claude Max subscription pool. " +
        "Prefer OAuth credential auth (see memory/claude-agent-sdk-billing.md)."
    );
  } else {
    const method = hasOauthToken
      ? "CLAUDE_CODE_OAUTH_TOKEN env"
      : "~/.claude/.credentials.json file";
    console.info(`[tars-worker] Claude auth: ${method} (subscription billing)`);
  }
}

export function loadConfig(): Config {
  const parsed = Schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n  ");
    throw new Error(`Invalid worker env:\n  ${issues}`);
  }
  warnIfNoClaudeAuth();
  return parsed.data;
}

export const callbackUrl = (cfg: Config): string =>
  new URL(cfg.TARS_WORKER_CALLBACK_PATH, cfg.TARS_APP_BASE_URL).toString();
