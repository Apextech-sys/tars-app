-- 0011: retention archive for pr_review_runs
--
-- Adds a single `archived_at` column to pr_review_runs. The retention
-- workflow (`workflows/retention-archive.ts`) compresses terminal-state rows
-- older than 30 days in place: heavy fields (disagreed_payload) are NULLed,
-- `error` is truncated to 200 chars, and `archived_at` is set. The slim
-- summary fields (run_id, owner, repo, pr_number, pr_sha, status,
-- findings_count, review_comment_url, adjudication_action,
-- adjudication_action_at, created_at, updated_at) are retained forever.
--
-- The audit_log rows for archived runs are also pruned by the workflow,
-- replaced with a single summary row (step='archived', status='info').
--
-- Idempotent: safe to re-run.
--
-- Down migration: archived rows have already been compressed in place;
-- a true rollback is impossible because the heavy fields are dropped.
-- The column itself can be dropped without data loss to the slim summary
-- (the column is NULL for un-archived rows and a timestamp for archived
-- rows; dropping the column loses the "archived" signal but preserves all
-- summary data).
--
--   ALTER TABLE pr_review_runs DROP COLUMN IF EXISTS archived_at;
--   DROP INDEX IF EXISTS pr_review_runs_unarchived_terminal_idx;

ALTER TABLE IF EXISTS pr_review_runs
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- Speeds up the retention sweep which scans for terminal-state rows older
-- than 30 days that haven't been archived yet.
CREATE INDEX IF NOT EXISTS pr_review_runs_unarchived_terminal_idx
  ON pr_review_runs (updated_at)
  WHERE archived_at IS NULL
    AND status IN ('completed', 'skipped-no-findings', 'skipped-policy',
                   'blocked-konverge', 'error', 'disagreed');
