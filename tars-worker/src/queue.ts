import { and, eq, lt, or, sql } from "drizzle-orm";
import pg from "pg";
import { tarsJobs } from "../../lib/db/worker-schema.js";
import type { Config } from "./config.js";
import { getDb, withTx } from "./db.js";
import { logger } from "./logger.js";
import type { JobRow } from "./types.js";

const { Client } = pg;

export function claimNextJob(workerId: string): Promise<JobRow | null> {
  return withTx(async (client) => {
    const claimSql = `
      WITH next AS (
        SELECT id
        FROM tars_jobs
        WHERE status = 'queued'
          AND attempts < max_attempts
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE tars_jobs t
      SET
        status      = 'running',
        worker_id   = $1,
        locked_at   = now(),
        started_at  = COALESCE(t.started_at, now()),
        attempts    = t.attempts + 1
      FROM next
      WHERE t.id = next.id
      RETURNING t.*;
    `;
    const res = await client.query<DbJobRow>(claimSql, [workerId]);
    if (res.rows.length === 0) {
      return null;
    }
    return rowToJob(res.rows[0]);
  });
}

export async function markDone(jobId: string, result: unknown): Promise<void> {
  const db = getDb();
  await db
    .update(tarsJobs)
    .set({
      status: "done",
      // biome-ignore lint/suspicious/noExplicitAny: opaque payload
      result: result as any,
      completedAt: new Date(),
      errorText: null,
    })
    .where(eq(tarsJobs.id, jobId));
}

export async function markFailed(
  jobId: string,
  errorText: string,
  opts: { allowRetry?: boolean } = {}
): Promise<{ requeued: boolean }> {
  const allowRetry = opts.allowRetry ?? true;
  const db = getDb();
  const rows = await db
    .select({
      attempts: tarsJobs.attempts,
      maxAttempts: tarsJobs.maxAttempts,
    })
    .from(tarsJobs)
    .where(eq(tarsJobs.id, jobId))
    .limit(1);

  if (rows.length === 0) {
    return { requeued: false };
  }
  const { attempts, maxAttempts } = rows[0];
  const hasRetriesLeft = allowRetry && attempts < maxAttempts;

  if (hasRetriesLeft) {
    await db
      .update(tarsJobs)
      .set({
        status: "queued",
        errorText,
        lockedAt: null,
        workerId: null,
      })
      .where(eq(tarsJobs.id, jobId));
    return { requeued: true };
  }

  await db
    .update(tarsJobs)
    .set({
      status: "failed",
      errorText,
      completedAt: new Date(),
    })
    .where(eq(tarsJobs.id, jobId));
  return { requeued: false };
}

export async function updateJobSession(
  jobId: string,
  sessionId: string
): Promise<void> {
  const db = getDb();
  await db.update(tarsJobs).set({ sessionId }).where(eq(tarsJobs.id, jobId));
}

export async function reclaimStuckJobs(cfg: Config): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - cfg.TARS_WORKER_STUCK_JOB_MS);
  const res = await db
    .update(tarsJobs)
    .set({
      status: "queued",
      lockedAt: null,
      workerId: null,
      errorText: sql`COALESCE(${tarsJobs.errorText}, '') || E'\n[reclaimed from stuck state]'`,
    })
    .where(
      and(
        eq(tarsJobs.status, "running"),
        or(lt(tarsJobs.lockedAt, cutoff), sql`${tarsJobs.lockedAt} IS NULL`)
      )
    )
    .returning({ id: tarsJobs.id });
  if (res.length > 0) {
    logger().warn(
      { reclaimed: res.length, ids: res.map((r) => r.id) },
      "reclaimed stuck jobs"
    );
  }
  return res.length;
}

export async function startNotifyListener(
  cfg: Config,
  onPoke: () => void
): Promise<() => Promise<void>> {
  const client = new Client({ connectionString: cfg.TARS_APP_DB_URL });
  await client.connect();
  await client.query("LISTEN tars_jobs_new");
  logger().info("LISTENing on tars_jobs_new channel");

  let pending: NodeJS.Timeout | null = null;
  const debounceMs = cfg.TARS_WORKER_NOTIFY_DEBOUNCE_MS;
  const fire = (): void => {
    if (pending) {
      return;
    }
    pending = setTimeout(() => {
      pending = null;
      try {
        onPoke();
      } catch (err) {
        logger().error({ err }, "notify poke handler threw");
      }
    }, debounceMs);
  };

  client.on("notification", (msg) => {
    logger().debug({ channel: msg.channel, payload: msg.payload }, "notify");
    fire();
  });
  client.on("error", (err) => {
    logger().error({ err }, "notify listener error");
  });

  return async () => {
    if (pending) {
      clearTimeout(pending);
    }
    try {
      await client.query("UNLISTEN tars_jobs_new");
    } catch {
      // ignore
    }
    await client.end().catch(() => undefined);
  };
}

interface DbJobRow {
  id: string;
  kind: string;
  // biome-ignore lint/suspicious/noExplicitAny: jsonb payload
  payload: any;
  status: string;
  // biome-ignore lint/suspicious/noExplicitAny: jsonb result
  result: any;
  error_text: string | null;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  attempts: number;
  max_attempts: number;
  idempotency_key: string | null;
  session_id: string | null;
  callback_url: string | null;
  callback_signed_token: string | null;
  worker_id: string | null;
  locked_at: Date | null;
}

function rowToJob(r: DbJobRow): JobRow {
  return {
    id: r.id,
    kind: r.kind,
    payload: r.payload ?? {},
    status: r.status,
    result: r.result,
    errorText: r.error_text,
    createdAt: r.created_at,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    idempotencyKey: r.idempotency_key,
    sessionId: r.session_id,
    callbackUrl: r.callback_url,
    callbackSignedToken: r.callback_signed_token,
    workerId: r.worker_id,
    lockedAt: r.locked_at,
  };
}
