-- repo_settings — watched repositories with webhook configuration.
-- Idempotent: safe to re-run. Created by M8 GitHub webhook ingress.

CREATE TABLE IF NOT EXISTS repo_settings (
  -- owner/repo format: e.g. "Apextech-sys/tars-app"
  repo_key        text PRIMARY KEY,
  owner           text NOT NULL,
  repo            text NOT NULL,
  -- Whether this repo gets auto PR review triggered on webhook
  webhook_enabled  boolean NOT NULL DEFAULT true,
  -- Whether auto_fix is allowed (false = konverge/read-only repos)
  auto_fix        boolean NOT NULL DEFAULT true,
  -- GitHub hook ID returned after registration (null = not yet registered)
  github_hook_id  bigint,
  -- Optional notes
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Seed the initial watched repos
INSERT INTO repo_settings (repo_key, owner, repo, webhook_enabled, auto_fix, notes)
VALUES
  ('Apextech-sys/tars-app',          'Apextech-sys', 'tars-app',          true,  true,  'TARS app itself — auto review on every PR'),
  ('Apextech-sys/polymarket-v2',     'Apextech-sys', 'polymarket-v2',     true,  true,  'Live trading repo — review enabled, auto_fix allowed'),
  ('Apextech-Dev/reflex-connect-aws','Apextech-Dev', 'reflex-connect-aws',true,  false, 'Konverge repo — review only, auto_fix DISABLED')
ON CONFLICT (repo_key) DO NOTHING;

-- webhook_events — raw audit log of every inbound GitHub webhook
CREATE TABLE IF NOT EXISTS webhook_events (
  id              bigserial PRIMARY KEY,
  event_type      text NOT NULL,
  delivery_id     text,
  repo_key        text NOT NULL,
  action          text,
  pr_number       integer,
  pr_sha          text,
  pr_title        text,
  sender_login    text,
  raw_payload     jsonb NOT NULL,
  triggered_run   text,   -- pr_review_runs.run_id if triggered
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_events_repo_key_idx ON webhook_events (repo_key, created_at DESC);
CREATE INDEX IF NOT EXISTS webhook_events_delivery_id_uidx ON webhook_events (delivery_id) WHERE delivery_id IS NOT NULL;
