-- PR title + author on the run.
--
-- The PR Runs list/detail used to derive the title/sender from a
-- webhook_events JOIN: `webhook_events.triggered_run = pr_review_runs.run_id`.
-- That join NEVER matched — triggered_run stores the WDK execution id
-- (wrun_…) returned by start(), while run_id is the workflow's own prrev_… id
-- generated inside the workflow — so pr_title/sender_login were NULL for 100%
-- of runs and the UI fell back to "PR #n".
--
-- Fix: capture the real title + author ON the run at fetch-pr time (from the
-- GitHub pulls.get response, see workflows/pr-review.ts), so the list/detail
-- read them directly and never depend on the fragile join. Works for
-- webhook- AND manually-triggered runs. Existing rows are backfilled from the
-- GitHub API by scripts/backfill-pr-titles.ts.
--
-- Additive + nullable, safe to apply online, idempotent via IF NOT EXISTS
-- (mirrors the self-healing ALTERs in workflows/lib/audit.ts, which is the
-- mechanism that actually runs on this Dokploy deploy where VERCEL_ENV is
-- unset and the build's db:migrate step is therefore skipped).
ALTER TABLE "pr_review_runs"
  ADD COLUMN IF NOT EXISTS "pr_title" text,
  ADD COLUMN IF NOT EXISTS "pr_author" text;
