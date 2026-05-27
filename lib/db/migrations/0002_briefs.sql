-- briefs — twice-daily TARS briefings (morning + evening).
-- Idempotent: safe to re-run. Created by M5 brief workflow.

CREATE TABLE IF NOT EXISTS briefs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date            date NOT NULL,
  -- kind: 'morning' | 'evening' | 'adhoc'
  kind            text NOT NULL,
  -- status: 'pending' | 'composing' | 'ready' | 'failed'
  status          text NOT NULL DEFAULT 'pending',
  -- The rendered markdown body shown in the UI.
  body_markdown   text,
  -- Short headline used in /briefs list views and notifications.
  summary         text,
  -- Structured payload returned by the compose handler, validated against
  -- BriefOutputSchema (insights[], next_actions[], questions[]).
  insights        jsonb,
  -- Graph snapshot + audit window + repo activity that drove the brief.
  source_context  jsonb,
  -- Workflow correlation IDs.
  run_id          text NOT NULL,
  job_id          uuid,
  error_text      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  CONSTRAINT briefs_kind_check CHECK (kind IN ('morning','evening','adhoc')),
  CONSTRAINT briefs_status_check CHECK (status IN ('pending','composing','ready','failed'))
);

CREATE INDEX IF NOT EXISTS briefs_date_kind_idx ON briefs (date DESC, kind);
CREATE INDEX IF NOT EXISTS briefs_status_idx ON briefs (status) WHERE status <> 'ready';
CREATE UNIQUE INDEX IF NOT EXISTS briefs_run_id_uidx ON briefs (run_id);

-- brief_replies — Shaun's replies threaded back from /briefs/[id] into chat.
CREATE TABLE IF NOT EXISTS brief_replies (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id        uuid NOT NULL REFERENCES briefs(id) ON DELETE CASCADE,
  chat_session_id uuid REFERENCES chat_sessions(id) ON DELETE SET NULL,
  user_id         text,
  body            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS brief_replies_brief_idx ON brief_replies (brief_id, created_at);
