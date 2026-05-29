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
  // Slice 1 (drizzle/0012): approval gate + Linear lifecycle columns. These
  // ALTERs are idempotent so a deploy that hasn't run the Drizzle migration
  // still self-heals on first workflow write.
  await sql /* sql */`
    alter table pr_review_runs
      add column if not exists agreed_findings jsonb,
      add column if not exists linear_issue_id text,
      add column if not exists linear_issue_identifier text,
      add column if not exists linear_issue_url text,
      add column if not exists approval_action text,
      add column if not exists approval_action_at timestamptz,
      add column if not exists approval_reason text;
  `;
  await sql /* sql */`
    create index if not exists pr_review_runs_pending_approval_idx
      on pr_review_runs (created_at desc)
      where status = 'pending-approval';
  `;
  // Slice 2 (drizzle/0013): fix-stage columns. Idempotent so a deploy that
  // hasn't run the Drizzle migration still self-heals on first fix write.
  await sql /* sql */`
    alter table pr_review_runs
      add column if not exists fix_status text,
      add column if not exists fix_branch text,
      add column if not exists fix_pr_url text,
      add column if not exists fix_pr_number integer,
      add column if not exists fix_revalidation jsonb,
      add column if not exists fix_blast_radius jsonb,
      add column if not exists fix_coverage_rootcause text;
  `;
  await sql /* sql */`
    create index if not exists pr_review_runs_fix_active_idx
      on pr_review_runs (updated_at desc)
      where status in ('fixing', 'fix-in-review', 'fix-failed');
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

/** Slim finding shape persisted on the run for the approval UI. */
export interface AgreedFinding {
  file: string;
  line?: number;
  severity: string;
  category?: string;
  message: string;
  suggestion?: string;
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
    // `blocked-konverge` is RETIRED (Slice 1) — kept in the union so historical
    // rows still type-check, but the workflow no longer produces it.
    | "blocked-konverge"
    | "disagreed"
    | "pending-approval"
    | "approved"
    | "rejected"
    // Slice 2 (fix stage) statuses:
    | "fixing"
    | "fix-in-review"
    | "fix-failed"
    | "done"
    | "error";
  findingsCount?: number;
  reviewCommentUrl?: string;
  error?: string;
  disagreedPayload?: DisagreedPayload;
  /** Agreed findings persisted at pending-approval for the approval UI. */
  agreedFindings?: AgreedFinding[];
  /** Linear issue created when the run reaches pending-approval. */
  linearIssueId?: string;
  linearIssueIdentifier?: string;
  linearIssueUrl?: string;
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
        findings_count, review_comment_url, error, disagreed_payload,
        agreed_findings, linear_issue_id, linear_issue_identifier,
        linear_issue_url, updated_at
      ) values (
        ${rec.runId}, ${rec.owner}, ${rec.repo}, ${rec.prNumber},
        ${rec.prSha ?? null},
        ${sql.json((rec.policy ?? {}) as any)},
        ${rec.status},
        ${rec.findingsCount ?? 0},
        ${rec.reviewCommentUrl ?? null},
        ${rec.error ?? null},
        ${rec.disagreedPayload ? sql.json(rec.disagreedPayload as any) : null},
        ${
          rec.agreedFindings
            ? sql.json(
                rec.agreedFindings as unknown as Parameters<typeof sql.json>[0]
              )
            : null
        },
        ${rec.linearIssueId ?? null},
        ${rec.linearIssueIdentifier ?? null},
        ${rec.linearIssueUrl ?? null},
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
        agreed_findings = coalesce(excluded.agreed_findings, pr_review_runs.agreed_findings),
        linear_issue_id = coalesce(excluded.linear_issue_id, pr_review_runs.linear_issue_id),
        linear_issue_identifier = coalesce(excluded.linear_issue_identifier, pr_review_runs.linear_issue_identifier),
        linear_issue_url = coalesce(excluded.linear_issue_url, pr_review_runs.linear_issue_url),
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

// ── Slice 2: fix-stage persistence ───────────────────────────────────────────

/** The run context the fix workflow needs to do its work. */
export interface RunForFix {
  runId: string;
  owner: string;
  repo: string;
  prNumber: number;
  prSha: string | null;
  status: string;
  policy: {
    issueTracker?: string;
    linearTeam?: string | null;
  } | null;
  agreedFindings: AgreedFinding[] | null;
  linearIssueId: string | null;
  linearIssueIdentifier: string | null;
  linearIssueUrl: string | null;
}

/**
 * Load an approved run for the fix workflow. Returns null if the row is
 * missing. `"use step"` so the WDK treats the DB read as a durable step.
 */
export async function getRunForFix(runId: string): Promise<RunForFix | null> {
  "use step";
  const sql = await makeSql();
  try {
    await ensureSchema(sql);
    const rows = await sql /* sql */`
      select run_id, owner, repo, pr_number, pr_sha, status, policy,
             agreed_findings, linear_issue_id, linear_issue_identifier,
             linear_issue_url
      from pr_review_runs where run_id = ${runId} limit 1
    `;
    if (rows.length === 0) {
      return null;
    }
    const r = rows[0] as Record<string, unknown>;
    return {
      runId: r.run_id as string,
      owner: r.owner as string,
      repo: r.repo as string,
      prNumber: r.pr_number as number,
      prSha: (r.pr_sha as string | null) ?? null,
      status: r.status as string,
      policy: (r.policy as RunForFix["policy"]) ?? null,
      agreedFindings: (r.agreed_findings as AgreedFinding[] | null) ?? null,
      linearIssueId: (r.linear_issue_id as string | null) ?? null,
      linearIssueIdentifier:
        (r.linear_issue_identifier as string | null) ?? null,
      linearIssueUrl: (r.linear_issue_url as string | null) ?? null,
    };
  } catch (err) {
    if (process.env.TARS_DEBUG_AUDIT) {
      console.warn("[audit] getRunForFix failed:", (err as Error).message);
    }
    return null;
  } finally {
    // biome-ignore lint/suspicious/noEmptyBlockStatements: best-effort pool shutdown
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

export interface FixResultUpdate {
  runId: string;
  /** The pr_review_runs.status to set (fixing | fix-in-review | fix-failed). */
  status: "fixing" | "fix-in-review" | "fix-failed" | "done";
  /** Granular sub-status string stored in fix_status. */
  fixStatus?: string;
  fixBranch?: string;
  fixPrUrl?: string;
  fixPrNumber?: number;
  fixRevalidation?: unknown;
  fixBlastRadius?: unknown;
  fixCoverageRootcause?: string;
  error?: string;
}

/**
 * Update the run row with fix-stage status + work product. Only writes the
 * columns that are provided (COALESCE keeps prior values), so calling it first
 * with `{ status: "fixing" }` and later with the full result is safe.
 */
export async function upsertFixResult(rec: FixResultUpdate): Promise<void> {
  "use step";
  const sql = await makeSql();
  try {
    await ensureSchema(sql);
    await sql /* sql */`
      update pr_review_runs set
        status = ${rec.status},
        fix_status = coalesce(${rec.fixStatus ?? null}, fix_status),
        fix_branch = coalesce(${rec.fixBranch ?? null}, fix_branch),
        fix_pr_url = coalesce(${rec.fixPrUrl ?? null}, fix_pr_url),
        fix_pr_number = coalesce(${rec.fixPrNumber ?? null}, fix_pr_number),
        fix_revalidation = coalesce(
          ${
            rec.fixRevalidation
              ? sql.json(
                  rec.fixRevalidation as Parameters<typeof sql.json>[0]
                )
              : null
          },
          fix_revalidation
        ),
        fix_blast_radius = coalesce(
          ${
            rec.fixBlastRadius
              ? sql.json(rec.fixBlastRadius as Parameters<typeof sql.json>[0])
              : null
          },
          fix_blast_radius
        ),
        fix_coverage_rootcause = coalesce(
          ${rec.fixCoverageRootcause ?? null}, fix_coverage_rootcause
        ),
        error = ${rec.error ?? null},
        updated_at = now()
      where run_id = ${rec.runId}
    `;
  } catch (err) {
    if (process.env.TARS_DEBUG_AUDIT) {
      console.warn("[audit] upsertFixResult failed:", (err as Error).message);
    }
  } finally {
    // biome-ignore lint/suspicious/noEmptyBlockStatements: best-effort pool shutdown
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}
