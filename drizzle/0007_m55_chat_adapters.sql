-- M5.5: Slack + Linear chat adapter columns on users + indexes
-- Idempotent: safe to re-run.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "slack_user_id" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "linear_user_id" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='users_slack_user_id_unique'
  ) THEN
    CREATE UNIQUE INDEX "users_slack_user_id_unique" ON "users" ("slack_user_id") WHERE "slack_user_id" IS NOT NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='users_linear_user_id_unique'
  ) THEN
    CREATE UNIQUE INDEX "users_linear_user_id_unique" ON "users" ("linear_user_id") WHERE "linear_user_id" IS NOT NULL;
  END IF;
END
$$;
