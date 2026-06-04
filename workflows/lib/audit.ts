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
  // Slice 3 (drizzle/0014): iterative debate transcript. Idempotent so a deploy
  // that hasn't run the Drizzle migration still self-heals on first write.
  await sql /* sql */`
    alter table pr_review_runs
      add column if not exists debate_rounds jsonb;
  `;
  // Slice 4 (drizzle/0015): deterministic baseline-diff test gate. Idempotent so
  // a deploy that hasn't run the Drizzle migration still self-heals on first
  // fix write.
  await sql /* sql */`
    alter table pr_review_runs
      add column if not exists fix_test_gate jsonb;
  `;
  // PR title + author (drizzle/0016): captured on the run at fetch-pr time so
  // the list/detail UI shows the real title instead of "PR #n". Idempotent so a
  // deploy that hasn't run the Drizzle migration still self-heals on first write
  // — this is the mechanism that actually runs here (VERCEL_ENV is unset on
  // Dokploy, so the build's db:migrate step is skipped).
  await sql /* sql */`
    alter table pr_review_runs
      add column if not exists pr_title text,
      add column if not exists pr_author text;
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

/** One reviewer's findings as captured at a given debate round. */
export interface DebateReviewerPosition {
  reviewer: "codex" | "claude";
  summary: string;
  findings: AgreedFinding[];
  /** Set on round >= 2: how this round's set changed vs the previous one. */
  endorsed?: number;
  retracted?: number;
}

/** A single debate round: both reviewers' positions for that round. */
export interface DebateRound {
  round: number;
  codex: DebateReviewerPosition;
  claude: DebateReviewerPosition;
}

/**
 * Full debate transcript persisted on the run. `rounds` is the per-round
 * exchange; `outcome` summarises convergence. Persisted as `debate_rounds`.
 */
export interface DebateTranscript {
  rounds: DebateRound[];
  maxRounds: number;
  /** Findings BOTH reviewers endorsed by the final round. */
  agreed: AgreedFinding[];
  /** Findings still raised by only one reviewer after the final round. */
  disputed: AgreedFinding[];
  /** Why the debate stopped: "converged" | "max-rounds" | "no-findings". */
  stopReason: "converged" | "max-rounds" | "no-findings";
}

export interface PrReviewRunRecord {
  runId: string;
  owner: string;
  repo: string;
  prNumber: number;
  prSha?: string;
  /** PR title from GitHub; persisted at fetch-pr time, COALESCEd on conflict. */
  prTitle?: string;
  /** PR author login from GitHub; persisted at fetch-pr time, COALESCEd. */
  prAuthor?: string;
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
  /** Slice 3: the iterative reviewer debate transcript. */
  debateRounds?: DebateTranscript;
  /** Agreed findings persisted at pending-approval for the approval UI. */
  agreedFindings?: AgreedFinding[];
  /** Linear issue created when the run reaches pending-approval. */
  linearIssueId?: string;
  linearIssueIdentifier?: string;
  linearIssueUrl?: string;
}

/**
 * jsonb-or-NULL helper. Returns NULL for null/undefined/empty objects so the
 * ON CONFLICT coalesces preserve prior values; otherwise wraps as sql.json.
 * Centralizing this keeps upsertPrReviewRun flat (one branch per column would
 * otherwise blow past the cognitive-complexity budget).
 */
type SqlClient = Awaited<ReturnType<typeof makeSql>>;

function jsonOrNull(
  sql: SqlClient,
  value: unknown
): ReturnType<SqlClient["json"]> | null {
  if (value == null) {
    return null;
  }
  if (
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).length === 0
  ) {
    return null;
  }
  return sql.json(value as Parameters<SqlClient["json"]>[0]);
}

export async function upsertPrReviewRun(rec: PrReviewRunRecord): Promise<void> {
  "use step";
  const sql = await makeSql();
  try {
    await ensureSchema(sql);
    // The baseline `started` insert runs BEFORE policy is resolved, so it has
    // no real policy yet. Writing `{}` there used to poison the row: the old
    // ON CONFLICT clause did `coalesce(existing, excluded)` which, because the
    // existing `{}` is non-null, NEVER let the later resolved policy overwrite
    // it. Fix: jsonOrNull() passes NULL (not `{}`) when the incoming policy is
    // empty, and a non-empty incoming policy WINS on conflict via
    // `coalesce(excluded, existing)` — so the resolved policy is always
    // persisted while an empty later write can't clobber an already-resolved one.
    await sql /* sql */`
      insert into pr_review_runs (
        run_id, owner, repo, pr_number, pr_sha, pr_title, pr_author, policy, status,
        findings_count, review_comment_url, error, disagreed_payload,
        debate_rounds, agreed_findings, linear_issue_id, linear_issue_identifier,
        linear_issue_url, updated_at
      ) values (
        ${rec.runId}, ${rec.owner}, ${rec.repo}, ${rec.prNumber},
        ${rec.prSha ?? null},
        ${rec.prTitle ?? null},
        ${rec.prAuthor ?? null},
        ${jsonOrNull(sql, rec.policy)},
        ${rec.status},
        ${rec.findingsCount ?? 0},
        ${rec.reviewCommentUrl ?? null},
        ${rec.error ?? null},
        ${jsonOrNull(sql, rec.disagreedPayload)},
        ${jsonOrNull(sql, rec.debateRounds)},
        ${jsonOrNull(sql, rec.agreedFindings)},
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
        -- Title/author are written once (at fetch-pr). A later started/no-title
        -- write passes NULL, so coalesce(excluded, existing) keeps the real value.
        pr_title = coalesce(excluded.pr_title, pr_review_runs.pr_title),
        pr_author = coalesce(excluded.pr_author, pr_review_runs.pr_author),
        policy = coalesce(excluded.policy, pr_review_runs.policy),
        disagreed_payload = coalesce(excluded.disagreed_payload, pr_review_runs.disagreed_payload),
        debate_rounds = coalesce(excluded.debate_rounds, pr_review_runs.debate_rounds),
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
  /** Slice 4: deterministic baseline-diff test-gate summary (JSON-safe). */
  fixTestGate?: unknown;
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
              ? sql.json(rec.fixRevalidation as Parameters<typeof sql.json>[0])
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
        fix_test_gate = coalesce(
          ${
            rec.fixTestGate
              ? sql.json(rec.fixTestGate as Parameters<typeof sql.json>[0])
              : null
          },
          fix_test_gate
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
