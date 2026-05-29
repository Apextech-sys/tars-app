import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * audit_log — written by M4 PR-review workflow steps.
 * Schema is owned externally (created by workflow migration);
 * we declare it here for Drizzle query access only.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: text("run_id").notNull(),
    workflow: text("workflow").notNull(),
    step: text("step").notNull(),
    status: text("status").notNull(),
    owner: text("owner"),
    repo: text("repo"),
    prNumber: integer("pr_number"),
    message: text("message"),
    data: jsonb("data"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    runIdIdx: index("audit_log_run_id_idx").on(t.runId),
  })
);

/**
 * pr_review_runs — written by the PR review workflow.
 *
 * `status` values used in code (status is stored as text, not an enum):
 *   started | skipped-no-findings | skipped-policy | disagreed
 *   pending-approval | approved | rejected | error
 *   Slice 2 (fix stage): fixing | fix-in-review | fix-failed | done
 *   (legacy/historical only: completed, blocked-konverge — protect_mode is
 *    retired as of Slice 1, but old rows still carry these statuses.)
 *
 * `fix_*` columns are written by the fix workflow (workflows/pr-fix.ts) once a
 * run is approved: fix_branch / fix_pr_url / fix_pr_number link the fix PR,
 * fix_revalidation records which findings survived independent re-check,
 * fix_blast_radius records the traced blast radius of the fix, and
 * fix_coverage_rootcause is the why-the-suite-missed-it analysis.
 * Migration: drizzle/0013_pr_review_fix_stage.sql.
 *
 * `disagreed_payload` is populated only when Codex and Claude disagree on
 * findings. It carries both raw reviewer outputs so Shaun can adjudicate
 * the disagreement from /inbox. Migration: drizzle/0008_pr_review_disagreed.sql.
 *
 * `agreed_findings` + the `linear_issue_*` + `approval_*` columns are written
 * when a run reaches `pending-approval`: the agreed findings drive the
 * approval UI, the Linear issue links the REF ticket, and the approval fields
 * record Shaun's Approve/Reject decision. Migration: drizzle/0012_*.sql.
 *
 * `debate_rounds` (Slice 3) records the iterative reviewer debate: an array of
 * rounds, each carrying both reviewers' positions for that round, plus a final
 * convergence summary (which findings became agreed vs stayed disputed).
 * Migration: drizzle/0014_pr_review_debate.sql.
 *
 * `archived_at` is set by the retention workflow once a terminal-state row
 * is older than 30 days; heavy fields (disagreed_payload) are NULLed and
 * `error` is truncated. Slim summary fields are kept forever.
 * Migration: drizzle/0011_pr_review_runs_archive.sql.
 */
export const prReviewRuns = pgTable("pr_review_runs", {
  runId: text("run_id").primaryKey(),
  owner: text("owner").notNull(),
  repo: text("repo").notNull(),
  prNumber: integer("pr_number").notNull(),
  prSha: text("pr_sha"),
  policy: jsonb("policy"),
  status: text("status").notNull(),
  findingsCount: integer("findings_count").notNull().default(0),
  reviewCommentUrl: text("review_comment_url"),
  error: text("error"),
  disagreedPayload: jsonb("disagreed_payload"),
  adjudicationAction: text("adjudication_action"),
  adjudicationActionAt: timestamp("adjudication_action_at", {
    withTimezone: true,
  }),
  // Slice 3: iterative debate transcript. Records each round's per-reviewer
  // positions and what converged. Migration: drizzle/0014_pr_review_debate.sql.
  debateRounds: jsonb("debate_rounds"),
  // Slice 1: approval gate + Linear lifecycle.
  agreedFindings: jsonb("agreed_findings"),
  linearIssueId: text("linear_issue_id"),
  linearIssueIdentifier: text("linear_issue_identifier"),
  linearIssueUrl: text("linear_issue_url"),
  approvalAction: text("approval_action"),
  approvalActionAt: timestamp("approval_action_at", { withTimezone: true }),
  approvalReason: text("approval_reason"),
  // Slice 2: FIX stage. fix_status carries a granular sub-status; the run's
  // top-level `status` carries fixing | fix-in-review | fix-failed | done.
  fixStatus: text("fix_status"),
  fixBranch: text("fix_branch"),
  fixPrUrl: text("fix_pr_url"),
  fixPrNumber: integer("fix_pr_number"),
  fixRevalidation: jsonb("fix_revalidation"),
  fixBlastRadius: jsonb("fix_blast_radius"),
  fixCoverageRootcause: text("fix_coverage_rootcause"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

type EscalationSeverity = "info" | "warn" | "blocker";
type EscalationStatus = "open" | "snoozed" | "resolved" | "deferred";

/**
 * escalations — inbox items needing Shaun's attention.
 */
export const escalations = pgTable(
  "escalations",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    source: text("source").notNull(),
    severity: text("severity").notNull().$type<EscalationSeverity>(),
    title: text("title").notNull(),
    bodyMarkdown: text("body_markdown"),
    payload: jsonb("payload"),
    status: text("status").notNull().default("open").$type<EscalationStatus>(),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by"),
    resolutionNote: text("resolution_note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    statusCreatedIdx: index("escalations_status_created_idx").on(
      t.status,
      t.createdAt
    ),
  })
);

/**
 * app_settings — key/value store for global app configuration.
 */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AuditLog = typeof auditLog.$inferSelect;
export type PrReviewRun = typeof prReviewRuns.$inferSelect;
export type Escalation = typeof escalations.$inferSelect;
export type NewEscalation = typeof escalations.$inferInsert;
export type AppSetting = typeof appSettings.$inferSelect;

// ── M8 tables (shipped): repo_settings + webhook_events ─────────────────────
// Applied in M8 (GitHub webhook integration). Migration: lib/db/migrations.legacy/0003_webhook_repos.sql.

export const repoSettings = pgTable("repo_settings", {
  repoKey: text("repo_key").primaryKey(),
  owner: text("owner").notNull(),
  repo: text("repo").notNull(),
  webhookEnabled: boolean("webhook_enabled").notNull().default(true),
  autoFix: boolean("auto_fix").notNull().default(true),
  githubHookId: bigint("github_hook_id", { mode: "number" }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    eventType: text("event_type").notNull(),
    deliveryId: text("delivery_id"),
    repoKey: text("repo_key").notNull(),
    action: text("action"),
    prNumber: integer("pr_number"),
    prSha: text("pr_sha"),
    prTitle: text("pr_title"),
    senderLogin: text("sender_login"),
    rawPayload: jsonb("raw_payload").notNull(),
    triggeredRun: text("triggered_run"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    repoKeyCreatedIdx: index("webhook_events_repo_key_idx").on(
      t.repoKey,
      t.createdAt
    ),
    deliveryIdIdx: uniqueIndex("webhook_events_delivery_id_uidx").on(
      t.deliveryId
    ),
  })
);

export type RepoSetting = typeof repoSettings.$inferSelect;
export type NewRepoSetting = typeof repoSettings.$inferInsert;
export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type NewWebhookEvent = typeof webhookEvents.$inferInsert;

/**
 * briefs — twice-daily TARS briefings (morning + evening).
 * Schema created by M5. Declared here for Drizzle query access.
 */
export const briefs = pgTable(
  "briefs",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    date: timestamp("date", { withTimezone: false }).notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("pending"),
    bodyMarkdown: text("body_markdown"),
    summary: text("summary"),
    insights: jsonb("insights"),
    sourceContext: jsonb("source_context"),
    runId: text("run_id").notNull(),
    jobId: text("job_id"),
    errorText: text("error_text"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => ({
    dateKindIdx: index("briefs_date_kind_idx").on(t.date, t.kind),
    runIdIdx: index("briefs_run_id_uidx").on(t.runId),
  })
);

/**
 * brief_replies — Shaun's threaded replies to a brief.
 */
export const briefReplies = pgTable(
  "brief_replies",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    briefId: text("brief_id").notNull(),
    chatSessionId: text("chat_session_id"),
    userId: text("user_id"),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    briefCreatedIdx: index("brief_replies_brief_idx").on(
      t.briefId,
      t.createdAt
    ),
  })
);

export type Brief = typeof briefs.$inferSelect;
export type NewBrief = typeof briefs.$inferInsert;
export type BriefReply = typeof briefReplies.$inferSelect;
