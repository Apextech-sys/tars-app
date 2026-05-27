-- 0009: adjudication action columns on pr_review_runs
-- Allows Shaun to record which action he took on a disagreed run from the UI.

ALTER TABLE pr_review_runs
  ADD COLUMN IF NOT EXISTS adjudication_action text,
  ADD COLUMN IF NOT EXISTS adjudication_action_at timestamptz;
