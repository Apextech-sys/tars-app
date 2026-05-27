"use server";

import { and, desc, gte, ilike, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/tars-schema";

export interface AuditFilters {
  runId?: string;
  steps?: string[];
  repos?: string[];
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
  const conditions = [];

  if (filters.runId) {
    conditions.push(ilike(auditLog.runId, `%${filters.runId}%`));
  }
  if (filters.steps && filters.steps.length > 0) {
    conditions.push(inArray(auditLog.step, filters.steps));
  }
  if (filters.repos && filters.repos.length > 0) {
    conditions.push(inArray(auditLog.repo, filters.repos));
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

  const escape = (v: unknown): string => {
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
      .map(escape)
      .join(",")
  );

  return [header, ...lines].join("\n");
}
