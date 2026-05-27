/**
 * Audit log writer.
 *
 * Every exported function is `"use step"` so the WDK treats it as a regular
 * Node step. Node modules + postgres are lazy-imported inside the steps so
 * the workflow-side static analyzer is happy.
 */

const AUDIT_LOG_PATH =
  process.env.TARS_AUDIT_LOG_PATH ?? "/home/shaun/.tars-state/audit.jsonl";

async function makeSql() {
  const postgres = (await import("postgres")).default;
  const url =
    process.env.WORKFLOW_POSTGRES_URL ??
    process.env.DATABASE_URL ??
    "postgres://tars_app:5bb16db4a6db588a087139b7225537595c0140791c0a037a@127.0.0.1:5433/tars_app";
  return postgres(url, { max: 2, idle_timeout: 20, prepare: false });
}

export interface AuditEntry {
  runId: string;
  workflow: string;
  step: string;
  status: "start" | "ok" | "skip" | "error" | "info";
  owner?: string;
  repo?: string;
  prNumber?: number;
  message?: string;
  data?: Record<string, unknown>;
}

async function ensureSchema(sql: any) {
  await sql /* sql */`
    create table if not exists audit_log (
      id            bigserial primary key,
      run_id        text not null,
      workflow      text not null,
      step          text not null,
      status        text not null,
      owner         text,
      repo          text,
      pr_number     integer,
      message       text,
      data          jsonb,
      created_at    timestamptz not null default now()
    );
  `;
  await sql /* sql */`
    create index if not exists audit_log_run_id_idx on audit_log(run_id);
  `;
  await sql /* sql */`
    create table if not exists pr_review_runs (
      run_id            text primary key,
      owner             text not null,
      repo              text not null,
      pr_number         integer not null,
      pr_sha            text,
      policy            jsonb,
      status            text not null,
      findings_count    integer not null default 0,
      review_comment_url text,
      error             text,
      created_at        timestamptz not null default now(),
      updated_at        timestamptz not null default now()
    );
  `;
  // Idempotent migration of older deployments that pre-date the
  // `disagreed_payload` column (see drizzle/0008_pr_review_disagreed.sql).
  await sql /* sql */`
    alter table pr_review_runs
      add column if not exists disagreed_payload jsonb;
  `;
  await sql /* sql */`
    create index if not exists pr_review_runs_disagreed_idx
      on pr_review_runs (created_at desc)
      where status = 'disagreed';
  `;
  await sql /* sql */`
    create table if not exists tars_jobs (
      job_id            text primary key,
      kind              text not null,
      payload           jsonb not null,
      status            text not null default 'pending',
      result            jsonb,
      error             text,
      created_at        timestamptz not null default now(),
      claimed_at        timestamptz,
      completed_at      timestamptz
    );
  `;
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  "use step";
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const row = { ts: new Date().toISOString(), ...entry };

  try {
    await fs.mkdir(path.dirname(AUDIT_LOG_PATH), { recursive: true });
    await fs.appendFile(AUDIT_LOG_PATH, `${JSON.stringify(row)}\n`, "utf8");
  } catch (err) {
    if (process.env.TARS_DEBUG_AUDIT) {
      console.warn("[audit] file write failed:", (err as Error).message);
    }
  }

  const sql = await makeSql();
  try {
    await ensureSchema(sql);
    await sql /* sql */`
      insert into audit_log (run_id, workflow, step, status, owner, repo, pr_number, message, data)
      values (
        ${entry.runId},
        ${entry.workflow},
        ${entry.step},
        ${entry.status},
        ${entry.owner ?? null},
        ${entry.repo ?? null},
        ${entry.prNumber ?? null},
        ${entry.message ?? null},
        ${sql.json((entry.data ?? {}) as any)}
      )
    `;
  } catch (err) {
    if (process.env.TARS_DEBUG_AUDIT) {
      console.warn("[audit] db write failed:", (err as Error).message);
    }
  } finally {
    // biome-ignore lint/suspicious/noEmptyBlockStatements: best-effort pool shutdown
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

/**
 * Raw per-reviewer payloads preserved when Codex and Claude disagree.
 * Persisted into pr_review_runs.disagreed_payload so Shaun can adjudicate
 * the disagreement himself from /inbox.
 */
export interface DisagreedPayload {
  codex: {
    summary: string;
    findings: unknown[];
    rawResult?: unknown;
    jobId?: string;
    errorText?: string | null;
  };
  claude: {
    summary: string;
    findings: unknown[];
    rawResult?: unknown;
    jobId?: string;
    errorText?: string | null;
  };
  overlapRatio?: number;
  capturedAt: string;
}

export interface PrReviewRunRecord {
  runId: string;
  owner: string;
  repo: string;
  prNumber: number;
  prSha?: string;
  policy?: Record<string, unknown>;
  status:
    | "started"
    | "completed"
    | "skipped-disagreement"
    | "skipped-no-findings"
    | "skipped-policy"
    | "blocked-konverge"
    | "disagreed"
    | "error";
  findingsCount?: number;
  reviewCommentUrl?: string;
  error?: string;
  disagreedPayload?: DisagreedPayload;
}

export async function upsertPrReviewRun(rec: PrReviewRunRecord): Promise<void> {
  "use step";
  const sql = await makeSql();
  try {
    await ensureSchema(sql);
    // `disagreed_payload` is passed as NULL when not provided so the COALESCE
    // in the ON CONFLICT clause preserves any earlier-written payload.
    await sql /* sql */`
      insert into pr_review_runs (
        run_id, owner, repo, pr_number, pr_sha, policy, status,
        findings_count, review_comment_url, error, disagreed_payload, updated_at
      ) values (
        ${rec.runId}, ${rec.owner}, ${rec.repo}, ${rec.prNumber},
        ${rec.prSha ?? null},
        ${sql.json((rec.policy ?? {}) as any)},
        ${rec.status},
        ${rec.findingsCount ?? 0},
        ${rec.reviewCommentUrl ?? null},
        ${rec.error ?? null},
        ${rec.disagreedPayload ? sql.json(rec.disagreedPayload as any) : null},
        now()
      )
      on conflict (run_id) do update set
        status = excluded.status,
        findings_count = excluded.findings_count,
        review_comment_url = excluded.review_comment_url,
        error = excluded.error,
        pr_sha = coalesce(pr_review_runs.pr_sha, excluded.pr_sha),
        policy = coalesce(pr_review_runs.policy, excluded.policy),
        disagreed_payload = coalesce(excluded.disagreed_payload, pr_review_runs.disagreed_payload),
        updated_at = now()
    `;
  } catch (err) {
    if (process.env.TARS_DEBUG_AUDIT) {
      console.warn("[audit] upsertPrReviewRun failed:", (err as Error).message);
    }
  } finally {
    // biome-ignore lint/suspicious/noEmptyBlockStatements: best-effort pool shutdown
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}
