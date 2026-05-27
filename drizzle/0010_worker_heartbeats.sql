-- 0010: worker_heartbeats table (if it doesn't exist yet from M3 schema)
-- The Drizzle schema already declares it; this migration guards against
-- environments where the M3 migration was not applied.

CREATE TABLE IF NOT EXISTS worker_heartbeats (
  worker_id   text PRIMARY KEY,
  last_seen   timestamptz NOT NULL DEFAULT now(),
  started_at  timestamptz NOT NULL DEFAULT now(),
  hostname    text,
  pid         integer,
  version     text
);
