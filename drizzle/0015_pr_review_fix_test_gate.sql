-- Slice 4: deterministic baseline-diff test gate.
--
-- The FIX stage no longer trusts the model's self-reported `existingTestsPassed`
-- boolean and no longer requires the WHOLE suite to pass. Instead the handler
-- runs the repo's test suite BEFORE the agent edits (the baseline) and AGAIN
-- after, with a machine-readable reporter, and compares per-test results. A fix
-- is SAFE iff it introduces no REGRESSION (a test that was passing in the
-- baseline and is now failing). Pre-existing reds and env-dependent tests that
-- fail in BOTH runs (e.g. DB tests with no DATABASE_URL in the ephemeral clone)
-- do NOT block the fix.
--
-- `fix_test_gate` persists that verdict so the dashboard can show the one-line
-- summary ("88 passing before -> 89 after, 0 regressions") and the PR body /
-- run record can flag any inconclusive run.
--
-- Additive + nullable, safe to apply online, idempotent via IF NOT EXISTS
-- (mirrors the self-healing ALTERs in workflows/lib/audit.ts).
ALTER TABLE "pr_review_runs"
  ADD COLUMN IF NOT EXISTS "fix_test_gate" jsonb;
