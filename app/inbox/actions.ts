"use server";

import { and, eq, gte, lt, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { appSettings, escalations, prReviewRuns } from "@/lib/db/tars-schema";
import { tarsJobs, workerHeartbeats } from "@/lib/db/worker-schema";

// ---------- helpers ----------

function nowPlusSecs(s: number): Date {
  return new Date(Date.now() + s * 1000);
}

const STALE_RUN_MS = 30 * 60 * 1000;
const STALE_JOB_MS = 24 * 60 * 60 * 1000;

/** Ordinal rank for finding severity — higher = more urgent. */
const SEVERITY_RANK: Record<string, number> = {
  critical: 5,
  blocker: 5,
  high: 4,
  major: 3,
  warn: 2,
  medium: 2,
  minor: 1,
  low: 1,
  info: 0,
};

export interface InboxFinding {
  file: string | null;
  line: number | null;
  severity: string;
  category: string | null;
  message: string;
  suggestion: string | null;
}

function severityRank(sev: string | null | undefined): number {
  if (!sev) {
    return 0;
  }
  return SEVERITY_RANK[sev.toLowerCase()] ?? 0;
}

/**
 * Normalise a raw finding object into a common shape. Agreed findings carry
 * `message`; reviewer (codex/claude) findings carry `title` + `detail`.
 */
function normaliseFinding(raw: unknown): InboxFinding {
  const f = (raw ?? {}) as Record<string, unknown>;
  const title = typeof f.title === "string" ? f.title : null;
  const message = typeof f.message === "string" ? f.message : null;
  const detail = typeof f.detail === "string" ? f.detail : null;
  const suggestion = typeof f.suggestion === "string" ? f.suggestion : null;
  return {
    file: typeof f.file === "string" ? f.file : null,
    line: typeof f.line === "number" ? f.line : null,
    severity: typeof f.severity === "string" ? f.severity : "info",
    category: typeof f.category === "string" ? f.category : null,
    message: message ?? title ?? "(no description)",
    suggestion: suggestion ?? detail,
  };
}

function maxSeverityOf(findings: InboxFinding[]): string | null {
  let best: string | null = null;
  let bestRank = -1;
  for (const f of findings) {
    const r = severityRank(f.severity);
    if (r > bestRank) {
      bestRank = r;
      best = f.severity;
    }
  }
  return best;
}

// ---------- dismissal store (app_settings KV, no schema change) ----------

const DISMISSAL_KEY = "inbox_dismissals";

type DismissalMap = Record<string, string>;

async function loadDismissals(): Promise<DismissalMap> {
  const row = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, DISMISSAL_KEY),
  });
  const value = row?.value as DismissalMap | null;
  return value && typeof value === "object" ? value : {};
}

async function saveDismissals(map: DismissalMap): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: DISMISSAL_KEY, value: map as never })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: map as never, updatedAt: new Date() },
    });
}

// ---------- inbox data fetch ----------

export type InboxItem =
  | {
      kind: "escalation";
      id: string;
      source: string;
      severity: "info" | "warn" | "blocker";
      title: string;
      bodyMarkdown: string | null;
      status: "open" | "snoozed" | "resolved" | "deferred";
      snoozedUntil: string | null;
      createdAt: string;
      ageMs: number;
    }
  | {
      kind: "workflow_stall";
      id: string;
      runId: string;
      owner: string;
      repo: string;
      prNumber: number;
      status: string;
      createdAt: string;
      ageMs: number;
      stale: boolean;
    }
  | {
      kind: "worker_failure";
      id: string;
      jobKind: string;
      count: number;
      sampleError: string | null;
      worstAttempts: number;
      newestAt: string;
      ageMs: number;
      stale: boolean;
    }
  | {
      kind: "pr_failure";
      id: string;
      runId: string;
      owner: string;
      repo: string;
      prNumber: number;
      error: string;
      createdAt: string;
      ageMs: number;
    }
  | {
      kind: "pr_disagreement";
      id: string;
      runId: string;
      owner: string;
      repo: string;
      prNumber: number;
      prSha: string | null;
      codexFindingsCount: number;
      claudeFindingsCount: number;
      codexFindings: InboxFinding[];
      claudeFindings: InboxFinding[];
      overlapRatio: number | null;
      maxSeverity: string | null;
      createdAt: string;
      ageMs: number;
    }
  | {
      kind: "pr_pending_approval";
      id: string;
      runId: string;
      owner: string;
      repo: string;
      prNumber: number;
      prSha: string | null;
      findingsCount: number;
      findings: InboxFinding[];
      maxSeverity: string | null;
      linearIssueIdentifier: string | null;
      linearIssueUrl: string | null;
      createdAt: string;
      ageMs: number;
    };

export interface InboxData {
  needsDecision: InboxItem[];
  fyi: InboxItem[];
}

function ageOf(iso: string): number {
  return Date.now() - new Date(iso).getTime();
}

/** Severity-then-age ordering for the Needs-decision column (anti-dormancy). */
function compareDecision(a: InboxItem, b: InboxItem): number {
  const sa = "maxSeverity" in a ? severityRank(a.maxSeverity) : 0;
  const sb = "maxSeverity" in b ? severityRank(b.maxSeverity) : 0;
  if (sa !== sb) {
    return sb - sa;
  }
  // Oldest-waiting first. worker_failure uses newestAt; all others use createdAt.
  const ts = (i: InboxItem): number =>
    new Date("createdAt" in i ? i.createdAt : i.newestAt).getTime();
  return ts(a) - ts(b);
}

export async function fetchInboxItems(): Promise<InboxItem[]> {
  const data = await fetchInboxData();
  return [...data.needsDecision, ...data.fyi];
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: single data-shaping pass over six heterogeneous sources; splitting it would scatter related queries.
export async function fetchInboxData(): Promise<InboxData> {
  const dismissals = await loadDismissals();
  const isDismissed = (id: string) => Boolean(dismissals[id]);

  const needsDecision: InboxItem[] = [];
  const fyi: InboxItem[] = [];

  // 1. Open / snoozed escalations → FYI unless blocker.
  const escRows = await db
    .select()
    .from(escalations)
    .where(
      or(
        eq(escalations.status, "open"),
        and(
          eq(escalations.status, "snoozed"),
          gte(escalations.snoozedUntil, sql`now()`)
        )
      )
    )
    .orderBy(sql`${escalations.createdAt} DESC`)
    .limit(100);

  for (const r of escRows) {
    const createdAt = r.createdAt.toISOString();
    const item: InboxItem = {
      kind: "escalation",
      id: r.id,
      source: r.source,
      severity: r.severity as "info" | "warn" | "blocker",
      title: r.title,
      bodyMarkdown: r.bodyMarkdown,
      status: r.status as "open" | "snoozed" | "resolved" | "deferred",
      snoozedUntil: r.snoozedUntil?.toISOString() ?? null,
      createdAt,
      ageMs: ageOf(createdAt),
    };
    if (r.severity === "blocker") {
      needsDecision.push(item);
    } else {
      fyi.push(item);
    }
  }

  // 2. Pending-approval PR review runs — reviewers agreed; Shaun must approve.
  const pendingApproval = await db
    .select()
    .from(prReviewRuns)
    .where(eq(prReviewRuns.status, "pending-approval"))
    .orderBy(sql`${prReviewRuns.createdAt} DESC`)
    .limit(50);

  for (const r of pendingApproval) {
    const id = `prapp-${r.runId}`;
    if (isDismissed(id)) {
      continue;
    }
    const rawAgreed = Array.isArray(r.agreedFindings) ? r.agreedFindings : [];
    const findings = (rawAgreed as unknown[]).map(normaliseFinding);
    const createdAt = r.createdAt.toISOString();
    needsDecision.push({
      kind: "pr_pending_approval",
      id,
      runId: r.runId,
      owner: r.owner,
      repo: r.repo,
      prNumber: r.prNumber,
      prSha: r.prSha,
      findingsCount: findings.length > 0 ? findings.length : r.findingsCount,
      findings,
      maxSeverity: maxSeverityOf(findings),
      linearIssueIdentifier: r.linearIssueIdentifier,
      linearIssueUrl: r.linearIssueUrl,
      createdAt,
      ageMs: ageOf(createdAt),
    });
  }

  // 3. Disagreed PR review runs — Codex/Claude diverged; Shaun adjudicates.
  const disagreedPRs = await db
    .select()
    .from(prReviewRuns)
    .where(eq(prReviewRuns.status, "disagreed"))
    .orderBy(sql`${prReviewRuns.createdAt} DESC`)
    .limit(50);

  for (const r of disagreedPRs) {
    const id = `prdis-${r.runId}`;
    if (isDismissed(id)) {
      continue;
    }
    const payload = r.disagreedPayload as {
      codex?: { findings?: unknown[] };
      claude?: { findings?: unknown[] };
      overlapRatio?: number;
    } | null;
    const codexRaw = payload?.codex?.findings ?? [];
    const claudeRaw = payload?.claude?.findings ?? [];
    const codexFindings = codexRaw.slice(0, 3).map(normaliseFinding);
    const claudeFindings = claudeRaw.slice(0, 3).map(normaliseFinding);
    const createdAt = r.createdAt.toISOString();
    needsDecision.push({
      kind: "pr_disagreement",
      id,
      runId: r.runId,
      owner: r.owner,
      repo: r.repo,
      prNumber: r.prNumber,
      prSha: r.prSha,
      codexFindingsCount: codexRaw.length,
      claudeFindingsCount: claudeRaw.length,
      codexFindings,
      claudeFindings,
      overlapRatio:
        typeof payload?.overlapRatio === "number" ? payload.overlapRatio : null,
      maxSeverity: maxSeverityOf([...codexFindings, ...claudeFindings]),
      createdAt,
      ageMs: ageOf(createdAt),
    });
  }

  // 4. Stalled PR review runs (status='started' > 5 min old) → FYI/health.
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const stalledRuns = await db
    .select()
    .from(prReviewRuns)
    .where(
      and(
        eq(prReviewRuns.status, "started"),
        lt(prReviewRuns.createdAt, fiveMinAgo)
      )
    )
    .limit(50);

  for (const r of stalledRuns) {
    const id = `stall-${r.runId}`;
    if (isDismissed(id)) {
      continue;
    }
    const createdAt = r.createdAt.toISOString();
    const ageMs = ageOf(createdAt);
    fyi.push({
      kind: "workflow_stall",
      id,
      runId: r.runId,
      owner: r.owner,
      repo: r.repo,
      prNumber: r.prNumber,
      status: r.status,
      createdAt,
      ageMs,
      stale: ageMs > STALE_RUN_MS,
    });
  }

  // 5. Errored PR review runs (error IS NOT NULL) → FYI/health.
  const failedPRs = await db
    .select()
    .from(prReviewRuns)
    .where(sql`${prReviewRuns.error} IS NOT NULL`)
    .orderBy(sql`${prReviewRuns.createdAt} DESC`)
    .limit(50);

  for (const r of failedPRs) {
    const id = `prfail-${r.runId}`;
    if (isDismissed(id)) {
      continue;
    }
    const createdAt = r.createdAt.toISOString();
    fyi.push({
      kind: "pr_failure",
      id,
      runId: r.runId,
      owner: r.owner,
      repo: r.repo,
      prNumber: r.prNumber,
      error: r.error ?? "unknown error",
      createdAt,
      ageMs: ageOf(createdAt),
    });
  }

  // 6. Failed tars_jobs (last 7 days), aggregated by kind → one FYI per kind.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const failedJobGroups = await db
    .select({
      jobKind: tarsJobs.kind,
      count: sql<number>`count(*)::int`,
      newestAt: sql<Date>`max(${tarsJobs.createdAt})`,
      worstAttempts: sql<number>`max(${tarsJobs.attempts})::int`,
      sampleError: sql<
        string | null
      >`(array_agg(${tarsJobs.errorText} order by ${tarsJobs.createdAt} desc))[1]`,
    })
    .from(tarsJobs)
    .where(
      and(eq(tarsJobs.status, "failed"), gte(tarsJobs.createdAt, sevenDaysAgo))
    )
    .groupBy(tarsJobs.kind)
    .orderBy(sql`count(*) DESC`);

  for (const g of failedJobGroups) {
    const id = `jobgroup-${g.jobKind}`;
    if (isDismissed(id)) {
      continue;
    }
    const newestAt = new Date(g.newestAt).toISOString();
    const ageMs = ageOf(newestAt);
    fyi.push({
      kind: "worker_failure",
      id,
      jobKind: g.jobKind,
      count: g.count,
      sampleError: g.sampleError,
      worstAttempts: g.worstAttempts,
      newestAt,
      ageMs,
      stale: ageMs > STALE_JOB_MS,
    });
  }

  needsDecision.sort(compareDecision);
  fyi.sort((a, b) => b.ageMs - a.ageMs);

  return { needsDecision, fyi };
}

export interface InboxSummary {
  pendingApproval: number;
  disagreed: number;
  criticalFindings: number;
  stalled: number;
  errored: number;
  failedJobs7d: number;
  oldestWaitingMs: number | null;
  workerLastSeenMs: number | null;
  workerId: string | null;
  latestBrief: { kind: string; date: string } | null;
}

interface PendingSummary {
  criticalFindings: number;
  oldestWaitingMs: number | null;
}

function countCriticals(findings: unknown[]): number {
  let n = 0;
  for (const f of findings as Record<string, unknown>[]) {
    const sev = typeof f.severity === "string" ? f.severity.toLowerCase() : "";
    if (sev === "critical" || sev === "blocker") {
      n += 1;
    }
  }
  return n;
}

/** Derive critical-finding count + oldest-waiting age over pending runs. */
function summarisePending(
  rows: { runId: string; agreedFindings: unknown; createdAt: Date }[],
  dismissals: DismissalMap
): PendingSummary {
  let criticalFindings = 0;
  let oldestWaitingMs: number | null = null;
  for (const r of rows) {
    if (dismissals[`prapp-${r.runId}`]) {
      continue;
    }
    const findings = Array.isArray(r.agreedFindings) ? r.agreedFindings : [];
    criticalFindings += countCriticals(findings);
    const age = Date.now() - r.createdAt.getTime();
    if (oldestWaitingMs === null || age > oldestWaitingMs) {
      oldestWaitingMs = age;
    }
  }
  return { criticalFindings, oldestWaitingMs };
}

/**
 * Single-query-batch hero summary so the client doesn't re-derive counts and
 * drift from the queue. Critical findings are derived in JS from agreed_findings.
 */
export async function getInboxSummary(): Promise<InboxSummary> {
  const dismissals = await loadDismissals();

  const statusRows = await db
    .select({ status: prReviewRuns.status, count: sql<number>`count(*)::int` })
    .from(prReviewRuns)
    .groupBy(prReviewRuns.status);
  const byStatus: Record<string, number> = {};
  for (const r of statusRows) {
    byStatus[r.status] = r.count;
  }

  // Stalled = started > 5 min old.
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const stalledRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(prReviewRuns)
    .where(
      and(
        eq(prReviewRuns.status, "started"),
        lt(prReviewRuns.createdAt, fiveMinAgo)
      )
    );
  const stalled = stalledRows[0]?.count ?? 0;

  const erroredRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(prReviewRuns)
    .where(sql`${prReviewRuns.error} IS NOT NULL`);
  const errored = erroredRows[0]?.count ?? 0;

  // Critical findings across pending-approval runs (JS-derived per dataGaps).
  const pendingRows = await db
    .select({
      runId: prReviewRuns.runId,
      agreedFindings: prReviewRuns.agreedFindings,
      createdAt: prReviewRuns.createdAt,
    })
    .from(prReviewRuns)
    .where(eq(prReviewRuns.status, "pending-approval"));
  const { criticalFindings, oldestWaitingMs } = summarisePending(
    pendingRows,
    dismissals
  );

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const failedJobRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tarsJobs)
    .where(
      and(eq(tarsJobs.status, "failed"), gte(tarsJobs.createdAt, sevenDaysAgo))
    );
  const failedJobs7d = failedJobRows[0]?.count ?? 0;

  const hbRows = await db
    .select()
    .from(workerHeartbeats)
    .orderBy(sql`${workerHeartbeats.lastSeen} DESC`)
    .limit(1);
  const hb = hbRows[0];

  return {
    pendingApproval: byStatus["pending-approval"] ?? 0,
    disagreed: byStatus.disagreed ?? 0,
    criticalFindings,
    stalled,
    errored,
    failedJobs7d,
    oldestWaitingMs,
    workerLastSeenMs: hb ? Date.now() - hb.lastSeen.getTime() : null,
    workerId: hb?.workerId ?? null,
    latestBrief: null,
  };
}

// ---------- dismiss / acknowledge (non-escalation items) ----------

export async function dismissInboxItem(
  id: string
): Promise<{ ok: boolean; error?: string }> {
  if (!id) {
    return { ok: false, error: "Missing id" };
  }
  const map = await loadDismissals();
  map[id] = new Date().toISOString();
  await saveDismissals(map);
  try {
    revalidatePath("/inbox");
  } catch {
    /* no-op outside request context */
  }
  return { ok: true };
}

export async function undismissInboxItem(
  id: string
): Promise<{ ok: boolean; error?: string }> {
  if (!id) {
    return { ok: false, error: "Missing id" };
  }
  const map = await loadDismissals();
  if (id in map) {
    delete map[id];
    await saveDismissals(map);
  }
  try {
    revalidatePath("/inbox");
  } catch {
    /* no-op outside request context */
  }
  return { ok: true };
}

export async function dismissInboxItems(
  ids: string[]
): Promise<{ ok: boolean; count: number }> {
  if (ids.length === 0) {
    return { ok: true, count: 0 };
  }
  const map = await loadDismissals();
  const now = new Date().toISOString();
  for (const id of ids) {
    map[id] = now;
  }
  await saveDismissals(map);
  try {
    revalidatePath("/inbox");
  } catch {
    /* no-op outside request context */
  }
  return { ok: true, count: ids.length };
}

/**
 * Approve or reject a pending-approval run directly from the inbox. Mirrors
 * the approval-action route (status change + best-effort Linear transition)
 * but as a server action so the inbox card can act inline.
 */
export async function approvalActionFromInbox(
  runId: string,
  action: "approve" | "reject",
  reason?: string
): Promise<{ ok: boolean; error?: string }> {
  const { transitionPrReviewIssue } = await import(
    "@/workflows/lib/linear-lifecycle"
  );

  const rows = await db
    .select()
    .from(prReviewRuns)
    .where(eq(prReviewRuns.runId, runId))
    .limit(1);
  if (rows.length === 0) {
    return { ok: false, error: "Run not found" };
  }
  const run = rows[0];
  if (run.status !== "pending-approval") {
    return { ok: false, error: `Run is "${run.status}", not pending-approval` };
  }
  if (run.approvalAction) {
    return { ok: false, error: `Already ${run.approvalAction}` };
  }

  const newStatus = action === "approve" ? "approved" : "rejected";
  await db
    .update(prReviewRuns)
    .set({
      status: newStatus,
      approvalAction: action,
      approvalActionAt: new Date(),
      approvalReason: reason ?? null,
      updatedAt: new Date(),
    })
    .where(eq(prReviewRuns.runId, runId));

  const policy =
    (run.policy as {
      issueTracker?: string;
      linearTeam?: string | null;
    } | null) ?? null;
  if (
    run.linearIssueId &&
    policy?.issueTracker === "linear" &&
    policy.linearTeam
  ) {
    try {
      await transitionPrReviewIssue({
        teamKey: policy.linearTeam,
        issueId: run.linearIssueId,
        phase: action === "approve" ? "approved" : "rejected",
      });
    } catch {
      // best-effort — status change already persisted
    }
  }

  try {
    revalidatePath("/inbox");
  } catch {
    /* no-op outside request context */
  }
  return { ok: true };
}

/** Approve several pending-approval runs in one shot (bulk affordance). */
export async function approveManyFromInbox(
  runIds: string[]
): Promise<{ ok: boolean; approved: number }> {
  let approved = 0;
  for (const runId of runIds) {
    const res = await approvalActionFromInbox(runId, "approve");
    if (res.ok) {
      approved += 1;
    }
  }
  try {
    revalidatePath("/inbox");
  } catch {
    /* no-op outside request context */
  }
  return { ok: true, approved };
}

export async function fetchInboxBadgeCount(): Promise<number> {
  const data = await fetchInboxData();
  return data.needsDecision.length;
}

/**
 * Returns the full disagreed_payload for a single PR review run so Shaun
 * can inspect the raw Codex and Claude outputs side-by-side from the inbox.
 */
export async function fetchPrDisagreement(runId: string): Promise<{
  runId: string;
  owner: string;
  repo: string;
  prNumber: number;
  prSha: string | null;
  createdAt: string;
  payload: unknown;
} | null> {
  const rows = await db
    .select()
    .from(prReviewRuns)
    .where(
      and(eq(prReviewRuns.runId, runId), eq(prReviewRuns.status, "disagreed"))
    )
    .limit(1);
  if (rows.length === 0) {
    return null;
  }
  const r = rows[0];
  return {
    runId: r.runId,
    owner: r.owner,
    repo: r.repo,
    prNumber: r.prNumber,
    prSha: r.prSha,
    createdAt: r.createdAt.toISOString(),
    payload: r.disagreedPayload,
  };
}

// ---------- mutations ----------

export async function resolveEscalation(id: string, note: string) {
  await db
    .update(escalations)
    .set({
      status: "resolved",
      resolvedAt: new Date(),
      resolvedBy: "shaun",
      resolutionNote: note,
      updatedAt: new Date(),
    })
    .where(eq(escalations.id, id));
  try {
    revalidatePath("/inbox");
  } catch {
    /* no-op outside request context */
  }
}

export async function snoozeEscalation(id: string, hours: number) {
  await db
    .update(escalations)
    .set({
      status: "snoozed",
      snoozedUntil: nowPlusSecs(hours * 3600),
      updatedAt: new Date(),
    })
    .where(eq(escalations.id, id));
  try {
    revalidatePath("/inbox");
  } catch {
    /* no-op outside request context */
  }
}

export async function deferEscalation(id: string) {
  await db
    .update(escalations)
    .set({ status: "deferred", updatedAt: new Date() })
    .where(eq(escalations.id, id));
  try {
    revalidatePath("/inbox");
  } catch {
    /* no-op outside request context */
  }
}

export async function createEscalation(data: {
  source: string;
  severity: "info" | "warn" | "blocker";
  title: string;
  bodyMarkdown?: string;
  payload?: Record<string, unknown>;
}) {
  await db.insert(escalations).values({
    source: data.source,
    severity: data.severity,
    title: data.title,
    bodyMarkdown: data.bodyMarkdown ?? null,
    payload: data.payload ?? null,
    status: "open",
  });
  try {
    revalidatePath("/inbox");
  } catch {
    /* no-op outside request context */
  }
}
