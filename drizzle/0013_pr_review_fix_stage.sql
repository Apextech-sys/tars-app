-- Slice 2: PR-review FIX stage columns.
--
-- After Shaun approves a run's agreed findings, the fix workflow re-validates
-- the findings, computes the blast radius of the proposed fix, applies the fix
-- within that radius, runs + expands the test suite, root-causes the coverage
-- gap, and opens a fix PR. The columns below persist that work product so the
-- dashboard can surface it and the Linear lifecycle can link it.
--
-- All additive + nullable, safe to apply online, idempotent via IF NOT EXISTS
-- (mirrors the self-healing ALTERs in workflows/lib/audit.ts).
ALTER TABLE "pr_review_runs"
  ADD COLUMN IF NOT EXISTS "fix_status" text,
  ADD COLUMN IF NOT EXISTS "fix_branch" text,
  ADD COLUMN IF NOT EXISTS "fix_pr_url" text,
  ADD COLUMN IF NOT EXISTS "fix_pr_number" integer,
  ADD COLUMN IF NOT EXISTS "fix_revalidation" jsonb,
  ADD COLUMN IF NOT EXISTS "fix_blast_radius" jsonb,
  ADD COLUMN IF NOT EXISTS "fix_coverage_rootcause" text;

-- Partial index for the dashboard "fix in review" / "fixing" surfaces.
CREATE INDEX IF NOT EXISTS "pr_review_runs_fix_active_idx"
  ON "pr_review_runs" ("updated_at" DESC)
  WHERE "status" IN ('fixing', 'fix-in-review', 'fix-failed');
