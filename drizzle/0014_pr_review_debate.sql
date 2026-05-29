-- Slice 3: iterative reviewer debate transcript.
--
-- The PR-review workflow no longer computes a one-shot agreement overlap.
-- Instead Codex and Claude debate up to MAX_DEBATE_ROUNDS: round 1 is the
-- independent review, and each subsequent round shows each reviewer the OTHER
-- reviewer's findings and asks them to endorse / defend / retract. A finding
-- becomes "agreed" once both reviewers endorse it; still-disputed findings
-- after the final round route to the existing disagreement adjudication panel.
--
-- `debate_rounds` persists the full transcript so the run-detail UI can show
-- how many rounds ran, what each reviewer flagged per round, and what converged.
--
-- Additive + nullable, safe to apply online, idempotent via IF NOT EXISTS
-- (mirrors the self-healing ALTERs in workflows/lib/audit.ts).
ALTER TABLE "pr_review_runs"
  ADD COLUMN IF NOT EXISTS "debate_rounds" jsonb;
