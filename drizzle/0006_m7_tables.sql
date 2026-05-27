-- M7: escalations inbox + app_settings tables

CREATE TABLE IF NOT EXISTS "escalations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "source" text NOT NULL,
  "severity" text NOT NULL,
  "title" text NOT NULL,
  "body_markdown" text,
  "payload" jsonb,
  "status" text NOT NULL DEFAULT 'open',
  "snoozed_until" timestamptz,
  "resolved_at" timestamptz,
  "resolved_by" text,
  "resolution_note" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "escalations_status_created_idx" ON "escalations" ("status", "created_at" DESC);

-- LISTEN/NOTIFY channel: escalations_change
-- Trigger fires on INSERT/UPDATE/DELETE on escalations
CREATE OR REPLACE FUNCTION notify_escalations_change()
RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('escalations_change', row_to_json(NEW)::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS escalations_notify ON escalations;
CREATE TRIGGER escalations_notify
  AFTER INSERT OR UPDATE ON escalations
  FOR EACH ROW EXECUTE FUNCTION notify_escalations_change();

CREATE TABLE IF NOT EXISTS "app_settings" (
  "key" text PRIMARY KEY,
  "value" jsonb NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- Seed default model settings
INSERT INTO "app_settings" ("key", "value") VALUES
  ('chat_model', '"claude-sonnet-4-5"'),
  ('code_review_model', '"claude-sonnet-4-5"')
ON CONFLICT ("key") DO NOTHING;
