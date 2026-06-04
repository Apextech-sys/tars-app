/**
 * Worker dispatch — wraps the M3 tars-worker API.
 *
 * The worker (M3) defines its own schema for `tars_jobs` (uuid primary key,
 * status queued/running/done/failed/cancelled). We dispatch a job by INSERT,
 * then poll for the result row. The worker also POSTs a HMAC-signed
 * callback to /api/webhooks/job-done; we don't rely on that here because
 * polling is the most robust path and keeps the workflow simple.
 *
 * All Node imports are lazy so the WDK static analyzer doesn't reject them.
 */

import type { JSONValue } from "postgres";

export interface DispatchOptions {
  idempotencyKey?: string;
  callbackUrl?: string;
  maxAttempts?: number;
}

export interface DispatchJobResult {
  jobId: string;
}

export interface JobResultRow {
  id: string;
  kind: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  result: unknown | null;
  errorText: string | null;
  attempts: number;
  completedAt: string | null;
}

async function makeSql() {
  const postgres = (await import("postgres")).default;
  const url =
    process.env.WORKFLOW_POSTGRES_URL ??
    process.env.DATABASE_URL ??
    "postgres://tars_app:5bb16db4a6db588a087139b7225537595c0140791c0a037a@127.0.0.1:5433/tars_app";
  return postgres(url, { max: 2, idle_timeout: 20, prepare: false });
}

export async function dispatchJob(
  kind: string,
  payload: Record<string, unknown>,
  opts: DispatchOptions = {}
): Promise<DispatchJobResult> {
  "use step";
  const crypto = await import("node:crypto");
  const sql = await makeSql();
  const jobId = crypto.randomUUID();
  try {
    // Resolve idempotency BEFORE INSERT — the existing unique index on
    // idempotency_key is a partial index (WHERE idempotency_key IS NOT NULL),
    // which postgres can't use as an ON CONFLICT target.
    if (opts.idempotencyKey) {
      const existing = await sql /* sql */`
        select id from tars_jobs where idempotency_key=${opts.idempotencyKey} limit 1
      `;
      if (existing.length > 0) {
        return { jobId: (existing[0] as { id: string }).id };
      }
    }
    await sql /* sql */`
      insert into tars_jobs (id, kind, payload, idempotency_key, callback_url, max_attempts)
      values (
        ${jobId},
        ${kind},
        ${sql.json(payload as unknown as JSONValue)},
        ${opts.idempotencyKey ?? null},
        ${opts.callbackUrl ?? null},
        ${opts.maxAttempts ?? 3}
      )
    `;
  } finally {
    // biome-ignore lint/suspicious/noEmptyBlockStatements: best-effort pool shutdown
    await sql.end({ timeout: 5 }).catch(() => {});
  }
  return { jobId };
}

/**
 * Poll for job completion. Returns the result row when status is done or
 * failed; throws on timeout.
 */
export async function waitForJob(
  jobId: string,
  opts: { timeoutMs?: number; pollIntervalMs?: number } = {}
): Promise<JobResultRow> {
  "use step";
  const timeoutMs = opts.timeoutMs ?? 8 * 60_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 2000;
  const started = Date.now();
  const sql = await makeSql();
  try {
    while (Date.now() - started < timeoutMs) {
      const rows = await sql /* sql */`
        select id, kind, status, result, error_text, attempts, completed_at
        from tars_jobs where id=${jobId} limit 1
      `;
      if (rows.length > 0) {
        const row = rows[0] as {
          id: string;
          kind: string;
          status: JobResultRow["status"];
          result: unknown;
          error_text: string | null;
          attempts: number;
          completed_at: Date | string | null;
        };
        if (
          row.status === "done" ||
          row.status === "failed" ||
          row.status === "cancelled"
        ) {
          return {
            id: row.id,
            kind: row.kind,
            status: row.status,
            result: row.result,
            errorText: row.error_text,
            attempts: row.attempts,
            completedAt:
              row.completed_at instanceof Date
                ? row.completed_at.toISOString()
                : (row.completed_at ?? null),
          };
        }
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    throw new Error(
      `waitForJob: timeout after ${timeoutMs}ms for job ${jobId}`
    );
  } finally {
    // biome-ignore lint/suspicious/noEmptyBlockStatements: best-effort pool shutdown
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

/**
 * pollJobOnce — fetch the current state of a tars_jobs row in a single
 * short step. Unlike `waitForJob`, this never sleeps; the caller is
 * expected to wrap it in a WDK-level retry loop (sleep + RetryableError)
 * so the workflow stays durable across worker restarts.
 *
 * Returns `null` while the job is still queued/running. Returns the row
 * once it reaches done/failed/cancelled.
 */
export async function pollJobOnce(jobId: string): Promise<JobResultRow | null> {
  "use step";
  const sql = await makeSql();
  try {
    const rows = await sql /* sql */`
      select id, kind, status, result, error_text, attempts, completed_at
      from tars_jobs where id=${jobId} limit 1
    `;
    if (rows.length === 0) {
      return null;
    }
    const row = rows[0] as {
      id: string;
      kind: string;
      status: JobResultRow["status"];
      result: unknown;
      error_text: string | null;
      attempts: number;
      completed_at: Date | string | null;
    };
    if (
      row.status !== "done" &&
      row.status !== "failed" &&
      row.status !== "cancelled"
    ) {
      return null;
    }
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      result: row.result,
      errorText: row.error_text,
      attempts: row.attempts,
      completedAt:
        row.completed_at instanceof Date
          ? row.completed_at.toISOString()
          : (row.completed_at ?? null),
    };
  } finally {
    // biome-ignore lint/suspicious/noEmptyBlockStatements: best-effort pool shutdown
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}
