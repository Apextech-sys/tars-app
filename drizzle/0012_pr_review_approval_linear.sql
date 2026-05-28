-- Slice 1: PR-review approval gate + Linear issue lifecycle.
--
-- Adds the columns the agree-path approval gate writes when a run reaches
-- `pending-approval`, plus the Shaun approve/reject decision fields. All
-- additive + nullable, so this is safe to apply online and idempotent via
-- IF NOT EXISTS (mirrors the self-healing ALTERs in workflows/lib/audit.ts).
ALTER TABLE "pr_review_runs"
  ADD COLUMN IF NOT EXISTS "agreed_findings" jsonb,
  ADD COLUMN IF NOT EXISTS "linear_issue_id" text,
  ADD COLUMN IF NOT EXISTS "linear_issue_identifier" text,
  ADD COLUMN IF NOT EXISTS "linear_issue_url" text,
  ADD COLUMN IF NOT EXISTS "approval_action" text,
  ADD COLUMN IF NOT EXISTS "approval_action_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "approval_reason" text;

-- Partial index for the inbox / dashboard "pending approval" surfaces.
CREATE INDEX IF NOT EXISTS "pr_review_runs_pending_approval_idx"
  ON "pr_review_runs" ("created_at" DESC)
  WHERE "status" = 'pending-approval';
