import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  chatMessages,
  chatMessagesRelations,
  chatSessions,
  chatSessionsRelations,
} from "./chat-schema";
import {
  accounts,
  apiKeys,
  integrations,
  sessions,
  users,
  verifications,
  workflowExecutionLogs,
  workflowExecutions,
  workflowExecutionsRelations,
  workflows,
} from "./schema";
import {
  appSettings,
  auditLog,
  briefReplies,
  briefs,
  escalations,
  prReviewRuns,
  repoSettings,
  webhookEvents,
} from "./tars-schema";
import { tarsJobs, workerHeartbeats } from "./worker-schema";

// Construct schema object for drizzle
const schema = {
  users,
  sessions,
  accounts,
  verifications,
  workflows,
  workflowExecutions,
  workflowExecutionLogs,
  workflowExecutionsRelations,
  apiKeys,
  integrations,
  chatSessions,
  chatMessages,
  chatSessionsRelations,
  chatMessagesRelations,
  tarsJobs,
  workerHeartbeats,
  auditLog,
  prReviewRuns,
  escalations,
  appSettings,
  repoSettings,
  webhookEvents,
  briefs,
  briefReplies,
};

const connectionString =
  process.env.DATABASE_URL || "postgres://localhost:5432/workflow";

// For migrations
export const migrationClient = postgres(connectionString, { max: 1 });

// Use global singleton to prevent connection exhaustion during HMR
const globalForDb = globalThis as unknown as {
  queryClient: ReturnType<typeof postgres> | undefined;
  db: PostgresJsDatabase<typeof schema> | undefined;
};

// For queries - reuse connection in development
const queryClient =
  globalForDb.queryClient ?? postgres(connectionString, { max: 10 });
export const db = globalForDb.db ?? drizzle(queryClient, { schema });

if (process.env.NODE_ENV !== "production") {
  globalForDb.queryClient = queryClient;
  globalForDb.db = db;
}
