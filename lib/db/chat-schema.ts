import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { relations } from "drizzle-orm";
import { users } from "./schema";

export const chatSessions = pgTable(
  "chat_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    claudeSessionId: text("claude_session_id"),
    title: text("title"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    archived: boolean("archived").notNull().default(false),
  },
  (table) => ({
    userActiveIdx: index("chat_sessions_user_active_idx")
      .on(table.userId, table.lastActiveAt)
      .where(sql`${table.archived} = false`),
  })
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    // biome-ignore lint/suspicious/noExplicitAny: JSONB type
    parts: jsonb("parts").notNull().$type<any[]>(),
    content: text("content"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    sessionIdx: index("chat_messages_session_idx").on(
      table.sessionId,
      table.createdAt
    ),
  })
);

export const chatSessionsRelations = relations(
  chatSessions,
  ({ many, one }) => ({
    messages: many(chatMessages),
    user: one(users, { fields: [chatSessions.userId], references: [users.id] }),
  })
);

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  session: one(chatSessions, {
    fields: [chatMessages.sessionId],
    references: [chatSessions.id],
  }),
}));
