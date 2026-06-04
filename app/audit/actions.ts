"use server";

import {
  and,
  desc,
  gte,
  ilike,
  inArray,
  lte,
  type SQL,
  sql,
} from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLog, prReviewRuns } from "@/lib/db/tars-schema";

export interface AuditFilters {
  runId?: string;
  steps?: string[];
  repos?: string[];
  statuses?: string[];
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

export interface AuditRow {
  id: number;
  runId: string;
  workflow: string;
  step: string;
  status: string;
  owner: string | null;
  repo: string | null;
  prNumber: number | null;
  message: string | null;
  data: unknown;
  createdAt: string;
}

export interface AuditResult {
  rows: AuditRow[];
  total: number;
}

function buildWhere(filters: AuditFilters) {
  const conditions: SQL[] = [];

  if (filters.runId) {
    conditions.push(ilike(auditLog.runId, `%${filters.runId}%`));
  }
  if (filters.steps && filters.steps.length > 0) {
    conditions.push(inArray(auditLog.step, filters.steps));
  }
  if (filters.repos && filters.repos.length > 0) {
    conditions.push(inArray(auditLog.repo, filters.repos));
  }
  if (filters.statuses && filters.statuses.length > 0) {
    conditions.push(inArray(auditLog.status, filters.statuses));
  }
  if (filters.dateFrom) {
    conditions.push(gte(auditLog.createdAt, new Date(filters.dateFrom)));
  }
  if (filters.dateTo) {
    conditions.push(lte(auditLog.createdAt, new Date(filters.dateTo)));
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}

export async function fetchAuditLogs(
  filters: AuditFilters
): Promise<AuditResult> {
  const limit = Math.min(filters.limit ?? 50, 200);
  const offset = filters.offset ?? 0;
  const where = buildWhere(filters);

  const [rows, countRes] = await Promise.all([
    db
      .select()
      .from(auditLog)
      .where(where)
      .orderBy(desc(auditLog.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql`count(*)`.mapWith(Number) })
      .from(auditLog)
      .where(where),
  ]);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      runId: r.runId,
      workflow: r.workflow,
      step: r.step,
      status: r.status,
      owner: r.owner,
      repo: r.repo,
      prNumber: r.prNumber,
      message: r.message,
      data: r.data,
      createdAt: r.createdAt.toISOString(),
    })),
    total: countRes[0]?.count ?? 0,
  };
}

export async function fetchAuditDistinctSteps(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ step: auditLog.step })
    .from(auditLog)
    .orderBy(auditLog.step);
  return rows.map((r) => r.step);
}

export async function fetchAuditDistinctRepos(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ repo: auditLog.repo })
    .from(auditLog)
    .where(sql`${auditLog.repo} IS NOT NULL`)
    .orderBy(auditLog.repo);
  return rows.map((r) => r.repo ?? "");
}

export async function exportAuditCsv(filters: AuditFilters): Promise<string> {
  const where = buildWhere(filters);
  const rows = await db
    .select()
    .from(auditLog)
    .where(where)
    .orderBy(desc(auditLog.createdAt))
    .limit(5000);

  const header =
    "id,run_id,workflow,step,status,owner,repo,pr_number,message,created_at";

  const escapeCsv = (v: unknown): string => {
    if (v === null || v === undefined) {
      return "";
    }
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const lines = rows.map((r) =>
    [
      r.id,
      r.runId,
      r.workflow,
      r.step,
      r.status,
      r.owner,
      r.repo,
      r.prNumber,
      r.message,
      r.createdAt.toISOString(),
    ]
      .map(escapeCsv)
      .join(",")
  );

  return [header, ...lines].join("\n");
}

// ── Redesign additions: hero summary, run-grouped stream, lazy step load ─────

export interface AuditBucket {
  label: string;
  count: number;
}

export interface AuditSummary {
  count24h: number;
  failures24h: number;
  runs24h: number;
  total: number;
  errorsAllTime: number;
  pendingDisagreedRuns: number;
  lastActionAt: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  byHour: AuditBucket[];
  byRepo: AuditBucket[];
  byStep: AuditBucket[];
  byStatus: AuditBucket[];
}

const FAILURE_STATUSES = ["error", "failed", "fix-failed"];

/**
 * One round-trip of GROUP BY queries powering the hero band + breakdown bars.
 * All metrics are scoped to the ~3-day audit_log retention window; the
 * pending/disagreed count comes from the 1:1 pr_review_runs join.
 */
export async function fetchAuditSummary(
  filters: AuditFilters = {}
): Promise<AuditSummary> {
  const where = buildWhere(filters);

  const [totals, hourRows, repoRows, stepRows, statusRows, pendingRows] =
    await Promise.all([
      db
        .select({
          total: sql<number>`count(*)`.mapWith(Number),
          count24h:
            sql<number>`count(*) filter (where ${auditLog.createdAt} >= now() - interval '24 hours')`.mapWith(
              Number
            ),
          runs24h:
            sql<number>`count(distinct ${auditLog.runId}) filter (where ${auditLog.createdAt} >= now() - interval '24 hours')`.mapWith(
              Number
            ),
          failures24h:
            sql<number>`count(*) filter (where ${auditLog.status} in ('error','failed','fix-failed') and ${auditLog.createdAt} >= now() - interval '24 hours')`.mapWith(
              Number
            ),
          errorsAllTime:
            sql<number>`count(*) filter (where ${auditLog.status} = 'error')`.mapWith(
              Number
            ),
          lastActionAt: sql<string | null>`max(${auditLog.createdAt})`,
          windowStart: sql<string | null>`min(${auditLog.createdAt})`,
          windowEnd: sql<string | null>`max(${auditLog.createdAt})`,
        })
        .from(auditLog)
        .where(where),
      db
        .select({
          label: sql<string>`to_char(date_trunc('hour', ${auditLog.createdAt}), 'YYYY-MM-DD HH24:00')`,
          count: sql<number>`count(*)`.mapWith(Number),
        })
        .from(auditLog)
        .where(
          and(where, sql`${auditLog.createdAt} >= now() - interval '24 hours'`)
        )
        .groupBy(sql`1`)
        .orderBy(sql`1`),
      db
        .select({
          label: sql<string>`coalesce(${auditLog.repo}, '—')`,
          count: sql<number>`count(*)`.mapWith(Number),
        })
        .from(auditLog)
        .where(where)
        .groupBy(auditLog.repo)
        .orderBy(desc(sql`count(*)`)),
      db
        .select({
          label: auditLog.step,
          count: sql<number>`count(*)`.mapWith(Number),
        })
        .from(auditLog)
        .where(where)
        .groupBy(auditLog.step)
        .orderBy(desc(sql`count(*)`)),
      db
        .select({
          label: auditLog.status,
          count: sql<number>`count(*)`.mapWith(Number),
        })
        .from(auditLog)
        .where(where)
        .groupBy(auditLog.status)
        .orderBy(desc(sql`count(*)`)),
      db
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(prReviewRuns)
        .where(inArray(prReviewRuns.status, ["pending-approval", "disagreed"])),
    ]);

  const t = totals[0];
  return {
    total: t?.total ?? 0,
    count24h: t?.count24h ?? 0,
    runs24h: t?.runs24h ?? 0,
    failures24h: t?.failures24h ?? 0,
    errorsAllTime: t?.errorsAllTime ?? 0,
    lastActionAt: toIso(t?.lastActionAt),
    windowStart: toIso(t?.windowStart),
    windowEnd: toIso(t?.windowEnd),
    pendingDisagreedRuns: pendingRows[0]?.count ?? 0,
    byHour: hourRows.map((r) => ({ label: r.label, count: r.count })),
    byRepo: repoRows.map((r) => ({ label: r.label, count: r.count })),
    byStep: stepRows.map((r) => ({ label: r.label, count: r.count })),
    byStatus: statusRows.map((r) => ({ label: r.label, count: r.count })),
  };
}

function toIso(v: string | Date | null | undefined): string | null {
  if (!v) {
    return null;
  }
  if (v instanceof Date) {
    return v.toISOString();
  }
  return new Date(v).toISOString();
}

export interface AuditRunGroup {
  runId: string;
  repo: string | null;
  owner: string | null;
  prNumber: number | null;
  stepCount: number;
  startedAt: string;
  endedAt: string;
  hadError: boolean;
  runStatus: string | null;
  findingsCount: number | null;
  reviewCommentUrl: string | null;
  linearIssueUrl: string | null;
  fixPrUrl: string | null;
}

export interface AuditRunsResult {
  runs: AuditRunGroup[];
  total: number;
}

/**
 * Run-grouped view: one card per PR-review run (one run = one run_id =
 * 13–23 sequential steps). LEFT JOINs pr_review_runs (1:1, confirmed 54↔54)
 * so each run carries its terminal OUTCOME + findings count.
 */
export async function fetchAuditRuns(
  filters: AuditFilters
): Promise<AuditRunsResult> {
  const limit = Math.min(filters.limit ?? 25, 100);
  const offset = filters.offset ?? 0;
  const where = buildWhere(filters);

  const grouped = db
    .select({
      runId: auditLog.runId,
      repo: sql<string | null>`max(${auditLog.repo})`,
      owner: sql<string | null>`max(${auditLog.owner})`,
      prNumber: sql<number | null>`max(${auditLog.prNumber})`,
      stepCount: sql<number>`count(*)`.mapWith(Number),
      startedAt: sql<string>`min(${auditLog.createdAt})`,
      endedAt: sql<string>`max(${auditLog.createdAt})`,
      hadError: sql<boolean>`bool_or(${auditLog.status} = 'error')`,
      runStatus: prReviewRuns.status,
      findingsCount: prReviewRuns.findingsCount,
      reviewCommentUrl: prReviewRuns.reviewCommentUrl,
      linearIssueUrl: prReviewRuns.linearIssueUrl,
      fixPrUrl: prReviewRuns.fixPrUrl,
    })
    .from(auditLog)
    .leftJoin(prReviewRuns, sql`${prReviewRuns.runId} = ${auditLog.runId}`)
    .where(where)
    .groupBy(
      auditLog.runId,
      prReviewRuns.status,
      prReviewRuns.findingsCount,
      prReviewRuns.reviewCommentUrl,
      prReviewRuns.linearIssueUrl,
      prReviewRuns.fixPrUrl
    )
    .orderBy(desc(sql`max(${auditLog.createdAt})`))
    .limit(limit)
    .offset(offset);

  const countQ = db
    .select({
      count: sql<number>`count(distinct ${auditLog.runId})`.mapWith(Number),
    })
    .from(auditLog)
    .where(where);

  const [rows, countRes] = await Promise.all([grouped, countQ]);

  return {
    runs: rows.map((r) => ({
      runId: r.runId,
      repo: r.repo,
      owner: r.owner,
      prNumber: r.prNumber,
      stepCount: r.stepCount,
      startedAt: toIso(r.startedAt) ?? "",
      endedAt: toIso(r.endedAt) ?? "",
      hadError: r.hadError ?? false,
      runStatus: r.runStatus,
      findingsCount: r.findingsCount,
      reviewCommentUrl: r.reviewCommentUrl,
      linearIssueUrl: r.linearIssueUrl,
      fixPrUrl: r.fixPrUrl,
    })),
    total: countRes[0]?.count ?? 0,
  };
}

export interface AuditStep {
  id: number;
  step: string;
  status: string;
  message: string | null;
  data: unknown;
  createdAt: string;
}

/** Ordered steps for a single run — lazy-loaded when a run card expands. */
export async function fetchRunSteps(runId: string): Promise<AuditStep[]> {
  const rows = await db
    .select({
      id: auditLog.id,
      step: auditLog.step,
      status: auditLog.status,
      message: auditLog.message,
      data: auditLog.data,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(sql`${auditLog.runId} = ${runId}`)
    .orderBy(auditLog.createdAt, auditLog.id);

  return rows.map((r) => ({
    id: r.id,
    step: r.step,
    status: r.status,
    message: r.message,
    data: r.data,
    createdAt: r.createdAt.toISOString(),
  }));
}

export interface AuditFailure {
  id: number;
  runId: string;
  repo: string | null;
  prNumber: number | null;
  step: string;
  detail: string;
  createdAt: string;
}

const FAILURE_DETAIL_MAX = 240;

/** The dedicated failure list for the spotlight section. */
export async function fetchAuditFailures(
  filters: AuditFilters = {}
): Promise<AuditFailure[]> {
  const where = and(
    buildWhere(filters),
    inArray(auditLog.status, FAILURE_STATUSES)
  );

  const rows = await db
    .select({
      id: auditLog.id,
      runId: auditLog.runId,
      repo: auditLog.repo,
      prNumber: auditLog.prNumber,
      step: auditLog.step,
      data: auditLog.data,
      message: auditLog.message,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(where)
    .orderBy(desc(auditLog.createdAt))
    .limit(50);

  return rows.map((r) => ({
    id: r.id,
    runId: r.runId,
    repo: r.repo,
    prNumber: r.prNumber,
    step: r.step,
    detail: failureDetail(r.message, r.data),
    createdAt: r.createdAt.toISOString(),
  }));
}

function failureDetail(message: string | null, data: unknown): string {
  if (message) {
    return clampLine(message);
  }
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    const text = d.errorText ?? d.message ?? d.reason;
    if (typeof text === "string") {
      return clampLine(text);
    }
  }
  return "Unknown failure";
}

function clampLine(s: string): string {
  const firstLine = s.split("\n")[0]?.trim() ?? s;
  if (firstLine.length > FAILURE_DETAIL_MAX) {
    return `${firstLine.slice(0, FAILURE_DETAIL_MAX)}…`;
  }
  return firstLine;
}
