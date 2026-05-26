import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * tars_jobs — queue of work items handed off from tars-app workflows to the
 * background `tars-worker` process. The trigger defined in
 * `lib/db/migrations/0001_tars_jobs.sql` fires `pg_notify('tars_jobs_new', id)`
 * whenever a row lands with `status='queued'`, allowing the worker to react
 * without polling.
 */
export const tarsJobs = pgTable(
  "tars_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    // status values: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
    status: text("status").notNull().default("queued"),
    // biome-ignore lint/suspicious/noExplicitAny: opaque handler result
    result: jsonb("result").$type<any>(),
    errorText: text("error_text"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    idempotencyKey: text("idempotency_key"),
    sessionId: text("session_id"),
    callbackUrl: text("callback_url"),
    callbackSignedToken: text("callback_signed_token"),
    workerId: text("worker_id"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
  },
  (table) => ({
    statusCreatedIdx: index("tars_jobs_status_created_idx").on(
      table.status,
      table.createdAt,
    ),
    idempotencyKeyIdx: uniqueIndex("tars_jobs_idempotency_key_uidx")
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
  }),
);

export const workerHeartbeats = pgTable("worker_heartbeats", {
  workerId: text("worker_id").primaryKey(),
  lastSeen: timestamp("last_seen", { withTimezone: true })
    .notNull()
    .defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  hostname: text("hostname"),
  pid: integer("pid"),
  version: text("version"),
});

export type TarsJob = typeof tarsJobs.$inferSelect;
export type NewTarsJob = typeof tarsJobs.$inferInsert;
export type WorkerHeartbeat = typeof workerHeartbeats.$inferSelect;
