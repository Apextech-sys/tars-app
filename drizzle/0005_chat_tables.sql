CREATE TABLE "chat_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "claude_session_id" text,
  "title" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "last_active_at" timestamptz NOT NULL DEFAULT now(),
  "archived" boolean NOT NULL DEFAULT false
);

CREATE TABLE "chat_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL REFERENCES "chat_sessions"("id") ON DELETE CASCADE,
  "role" text NOT NULL CHECK ("role" IN ('user', 'assistant', 'system')),
  "parts" jsonb NOT NULL,
  "content" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "chat_sessions_user_active_idx" ON "chat_sessions" ("user_id", "last_active_at" DESC) WHERE "archived" = false;
CREATE INDEX "chat_messages_session_idx" ON "chat_messages" ("session_id", "created_at");
