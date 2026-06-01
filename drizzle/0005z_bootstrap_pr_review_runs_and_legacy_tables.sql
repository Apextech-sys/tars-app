-- Bootstrap migration: tables that were created on VM-102 via drizzle-kit push
-- (not via SQL migration files) and via lib/db/migrations/*.sql (which are not
-- in the drizzle/ journal). Required before 0008+ can apply their ALTER/INDEX.
-- Idempotent: all CREATE TABLE/INDEX use IF NOT EXISTS. Safe to re-run.

-- ── tars_jobs + worker_heartbeats + NOTIFY trigger ──────────────────────────
-- Originally from lib/db/migrations/0001_tars_jobs.sql

CREATE TABLE IF NOT EXISTS tars_jobs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                   text NOT NULL,
  payload                jsonb NOT NULL DEFAULT '{}'::jsonb,
  status                 text NOT NULL DEFAULT 'queued',
  result                 jsonb,
  error_text             text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  started_at             timestamptz,
  completed_at           timestamptz,
  attempts               integer NOT NULL DEFAULT 0,
  max_attempts           integer NOT NULL DEFAULT 3,
  idempotency_key        text,
  session_id             text,
  callback_url           text,
  callback_signed_token  text,
  worker_id              text,
  locked_at              timestamptz
);

CREATE INDEX IF NOT EXISTS tars_jobs_status_created_idx
  ON tars_jobs (status, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS tars_jobs_idempotency_key_uidx
  ON tars_jobs (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS worker_heartbeats (
  worker_id   text PRIMARY KEY,
  last_seen   timestamptz NOT NULL DEFAULT now(),
  started_at  timestamptz NOT NULL DEFAULT now(),
  hostname    text,
  pid         integer,
  version     text
);

CREATE OR REPLACE FUNCTION tars_jobs_notify()
RETURNS trigger
LANGUAGE plpgsql
AS $func$
BEGIN
  IF NEW.status = 'queued' THEN
    PERFORM pg_notify('tars_jobs_new', NEW.id::text);
  END IF;
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS tars_jobs_notify_insert ON tars_jobs;
CREATE TRIGGER tars_jobs_notify_insert
AFTER INSERT ON tars_jobs
FOR EACH ROW
EXECUTE FUNCTION tars_jobs_notify();

DROP TRIGGER IF EXISTS tars_jobs_notify_update ON tars_jobs;
CREATE TRIGGER tars_jobs_notify_update
AFTER UPDATE OF status ON tars_jobs
FOR EACH ROW
WHEN (NEW.status = 'queued' AND OLD.status IS DISTINCT FROM 'queued')
EXECUTE FUNCTION tars_jobs_notify();

-- ── pr_review_runs ──────────────────────────────────────────────────────────
-- Created via drizzle-kit push on VM-102 (no SQL file ever existed).
-- Referenced by 0008_pr_review_disagreed.sql + all subsequent migrations.
-- Full column set as of 2026-06-01 including all slice columns.

CREATE TABLE IF NOT EXISTS pr_review_runs (
  run_id                  text PRIMARY KEY,
  owner                   text NOT NULL,
  repo                    text NOT NULL,
  pr_number               integer NOT NULL,
  pr_sha                  text,
  policy                  jsonb,
  status                  text NOT NULL,
  findings_count          integer NOT NULL DEFAULT 0,
  review_comment_url      text,
  error                   text,
  disagreed_payload       jsonb,
  adjudication_action     text,
  adjudication_action_at  timestamptz,
  debate_rounds           jsonb,
  agreed_findings         jsonb,
  linear_issue_id         text,
  linear_issue_identifier text,
  linear_issue_url        text,
  approval_action         text,
  approval_action_at      timestamptz,
  approval_reason         text,
  fix_status              text,
  fix_branch              text,
  fix_pr_url              text,
  fix_pr_number           integer,
  fix_revalidation        jsonb,
  fix_blast_radius        jsonb,
  fix_coverage_rootcause  text,
  fix_test_gate           jsonb,
  archived_at             timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- ── audit_log ───────────────────────────────────────────────────────────────
-- Written by M4 PR-review workflow steps (drizzle-kit push, no prior SQL file).

CREATE TABLE IF NOT EXISTS audit_log (
  id          bigserial PRIMARY KEY,
  run_id      text NOT NULL,
  workflow    text NOT NULL,
  step        text NOT NULL,
  status      text NOT NULL,
  owner       text,
  repo        text,
  pr_number   integer,
  message     text,
  data        jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_run_id_idx ON audit_log (run_id);

-- ── repo_settings + webhook_events ─────────────────────────────────────────
-- Originally from lib/db/migrations/0003_webhook_repos.sql (M8).

CREATE TABLE IF NOT EXISTS repo_settings (
  repo_key         text PRIMARY KEY,
  owner            text NOT NULL,
  repo             text NOT NULL,
  webhook_enabled  boolean NOT NULL DEFAULT true,
  auto_fix         boolean NOT NULL DEFAULT true,
  github_hook_id   bigint,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

INSERT INTO repo_settings (repo_key, owner, repo, webhook_enabled, auto_fix, notes)
VALUES
  ('Apextech-sys/tars-app',          'Apextech-sys', 'tars-app',          true,  true,  'TARS app itself — auto review on every PR'),
  ('Apextech-sys/polymarket-v2',     'Apextech-sys', 'polymarket-v2',     true,  true,  'Live trading repo — review enabled, auto_fix allowed'),
  ('Apextech-Dev/reflex-connect-aws','Apextech-Dev', 'reflex-connect-aws',true,  false, 'Konverge repo — review only, auto_fix DISABLED')
ON CONFLICT (repo_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS webhook_events (
  id            bigserial PRIMARY KEY,
  event_type    text NOT NULL,
  delivery_id   text,
  repo_key      text NOT NULL,
  action        text,
  pr_number     integer,
  pr_sha        text,
  pr_title      text,
  sender_login  text,
  raw_payload   jsonb NOT NULL,
  triggered_run text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_events_repo_key_idx
  ON webhook_events (repo_key, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_delivery_id_uidx
  ON webhook_events (delivery_id)
  WHERE delivery_id IS NOT NULL;
