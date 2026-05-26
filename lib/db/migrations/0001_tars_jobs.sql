-- tars_jobs + worker_heartbeats schema + NOTIFY trigger.
-- Idempotent: safe to re-run.

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
  locked_at              timestamptz,
  CONSTRAINT tars_jobs_status_check
    CHECK (status IN ('queued','running','done','failed','cancelled'))
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
