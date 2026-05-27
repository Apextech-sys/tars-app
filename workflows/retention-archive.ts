/**
 * TARS retention-archive workflow.
 *
 * Compresses pr_review_runs rows older than 30 days down to a slim summary,
 * dropping heavy fields. Audit_log rows for archived runs are pruned to a
 * single summary row (`step='archived', status='info'`).
 *
 * Shaun's policy: full row retained for 30 days for debugging; after that,
 * keep the slim summary forever so the dashboard timeline stays meaningful.
 *
 * Triggered by systemd timer (`tars-retention-archive.timer`) hitting
 * `POST /api/tars/retention-archive` once per day at 03:00 UTC, matching
 * the same systemd-timer-hits-HTTP pattern used by the M5 brief workflow.
 *
 * Fields retained forever:
 *   run_id, owner, repo, pr_number, pr_sha, status, findings_count,
 *   review_comment_url, adjudication_action, adjudication_action_at,
 *   created_at, updated_at, policy, error (truncated to 200 chars)
 *
 * Fields dropped on archive (set NULL):
 *   disagreed_payload
 *
 * Safety:
 *   - NEVER archives rows in the `started` state — those are in-flight.
 *     Archiving an in-flight run would orphan its audit data while the
 *     workflow is still completing.
 *   - Batches of 50 rows per transaction so a partial failure doesn't
 *     block forward progress.
 *   - Idempotent: re-runnable. Already-archived rows are skipped via
 *     the `archived_at IS NULL` predicate.
 *   - All operations write audit_log entries with workflow='retention'
 *     so the sweep itself is traceable.
 */

import { writeAudit } from "./lib/audit";

export interface RetentionInput {
  /** Override the retention cutoff for testing (ISO timestamp). Default = now - 30 days. */
  cutoffIso?: string;
  /** Override the batch size. Default 50. */
  batchSize?: number;
  /** Dry-run mode: compute candidates but don't mutate anything. */
  dryRun?: boolean;
}

export interface RetentionResult {
  runId: string;
  archived: number;
  prunedAuditRows: number;
  cutoffIso: string;
  dryRun: boolean;
}

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_RETENTION_DAYS = 30;
const ERROR_TRUNCATE_LEN = 200;
const TERMINAL_STATUSES = [
  "completed",
  "skipped-no-findings",
  "skipped-policy",
  "blocked-konverge",
  "error",
  "disagreed",
];

/**
 * Sweep eligible rows and archive them in batches. Returns aggregate counts.
 *
 * Marked "use step" so the WDK treats it as a regular Node step (postgres
 * import is lazy, matching the audit.ts pattern).
 */
export async function sweepArchive(
  input: RetentionInput,
  runId: string
): Promise<{ archived: number; prunedAuditRows: number; cutoffIso: string }> {
  "use step";

  const postgres = (await import("postgres")).default;
  const url =
    process.env.WORKFLOW_POSTGRES_URL ??
    process.env.DATABASE_URL ??
    "postgres://tars_app:5bb16db4a6db588a087139b7225537595c0140791c0a037a@127.0.0.1:5433/tars_app";
  const sql = postgres(url, { max: 2, idle_timeout: 20, prepare: false });

  const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
  const cutoff = input.cutoffIso
    ? new Date(input.cutoffIso)
    : new Date(Date.now() - DEFAULT_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  let archived = 0;
  let prunedAuditRows = 0;

  try {
    // Loop until no more candidates. Bounded by an arbitrary high ceiling
    // so we always terminate; each batch shrinks the candidate set.
    const MAX_BATCHES = 1000;
    for (let i = 0; i < MAX_BATCHES; i++) {
      const candidates = await sql<{ run_id: string }[]> /* sql */`
        SELECT run_id
        FROM pr_review_runs
        WHERE archived_at IS NULL
          AND updated_at < ${cutoff}
          AND status = ANY(${TERMINAL_STATUSES})
        ORDER BY updated_at ASC
        LIMIT ${batchSize}
      `;

      if (candidates.length === 0) {
        break;
      }

      const runIds = candidates.map((c) => c.run_id);

      if (input.dryRun) {
        archived += candidates.length;
        continue;
      }

      // For each candidate, count + summarize its audit_log rows, delete
      // them, write a single summary row, then null out heavy fields on
      // the pr_review_runs row.
      for (const candidateRunId of runIds) {
        const auditRows = await sql<
          {
            count: number;
            last_step: string | null;
            last_status: string | null;
          }[]
        > /* sql */`
          SELECT
            count(*)::int                         AS count,
            (SELECT step   FROM audit_log a2 WHERE a2.run_id = ${candidateRunId} ORDER BY a2.created_at DESC LIMIT 1) AS last_step,
            (SELECT status FROM audit_log a2 WHERE a2.run_id = ${candidateRunId} ORDER BY a2.created_at DESC LIMIT 1) AS last_status
          FROM audit_log
          WHERE run_id = ${candidateRunId}
        `;

        const stats = auditRows[0] ?? {
          count: 0,
          last_step: null,
          last_status: null,
        };
        const summaryData = {
          steps: stats.count,
          last_step: stats.last_step,
          last_status: stats.last_status,
        };

        await sql.begin(async (tx) => {
          // Delete all existing audit rows for this run.
          await tx /* sql */`
            DELETE FROM audit_log WHERE run_id = ${candidateRunId}
          `;
          // Insert a single summary row.
          await tx /* sql */`
            INSERT INTO audit_log (run_id, workflow, step, status, message, data)
            VALUES (
              ${candidateRunId},
              'retention',
              'archived',
              'info',
              'Detailed audit trail archived',
              ${tx.json(summaryData)}
            )
          `;
          // Null heavy fields + truncate error + set archived_at.
          await tx /* sql */`
            UPDATE pr_review_runs
            SET
              disagreed_payload = NULL,
              error = CASE
                WHEN error IS NULL THEN NULL
                WHEN length(error) > ${ERROR_TRUNCATE_LEN} THEN left(error, ${ERROR_TRUNCATE_LEN})
                ELSE error
              END,
              archived_at = now()
            WHERE run_id = ${candidateRunId}
              AND archived_at IS NULL
          `;
        });

        prunedAuditRows += Math.max(0, stats.count);
        archived += 1;
      }
    }

    // Top-level audit row for the sweep itself.
    await writeAudit({
      runId,
      workflow: "retention",
      step: "sweep-complete",
      status: "ok",
      message: `archived=${archived} prunedAuditRows=${prunedAuditRows} dryRun=${input.dryRun ?? false}`,
      data: {
        archived,
        prunedAuditRows,
        cutoffIso: cutoff.toISOString(),
        dryRun: input.dryRun ?? false,
      },
    });
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {
      // best-effort pool shutdown
    });
  }

  return {
    archived,
    prunedAuditRows,
    cutoffIso: cutoff.toISOString(),
  };
}

/**
 * Workflow entry point. Following the M5 brief workflow pattern: a thin
 * orchestrator that calls "use step" functions. Kept deliberately small
 * because the bulk of the logic lives in sweepArchive.
 */
export async function retentionArchiveWorkflow(
  input: RetentionInput = {}
): Promise<RetentionResult> {
  "use workflow";

  const runId = `retn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  await writeAudit({
    runId,
    workflow: "retention",
    step: "sweep-start",
    status: "info",
    message: "starting retention sweep",
    data: { input },
  });

  const result = await sweepArchive(input, runId);

  return {
    runId,
    archived: result.archived,
    prunedAuditRows: result.prunedAuditRows,
    cutoffIso: result.cutoffIso,
    dryRun: input.dryRun ?? false,
  };
}
