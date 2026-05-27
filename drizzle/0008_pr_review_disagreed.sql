-- M4 follow-up: route Codex/Claude disagreements to a terminal `disagreed`
-- status with raw per-reviewer payloads preserved for Shaun's adjudication.
--
-- Idempotent: safe to re-run. Adds the column and a partial index for the
-- inbox query that surfaces disagreements.

ALTER TABLE IF EXISTS pr_review_runs
  ADD COLUMN IF NOT EXISTS disagreed_payload jsonb;

-- Speeds up the inbox roll-up that looks for status='disagreed' rows.
CREATE INDEX IF NOT EXISTS pr_review_runs_disagreed_idx
  ON pr_review_runs (created_at DESC)
  WHERE status = 'disagreed';
