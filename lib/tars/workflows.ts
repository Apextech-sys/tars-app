/**
 * Server-side data layer for the /workflows control room.
 *
 * Surfaces TARS's OWN durable WDK workflows (pr-review / pr-fix / brief /
 * retention-archive / chat) backed by pr_review_runs + audit_log + tars_jobs +
 * worker_heartbeats — NOT the @xyflow user visual-builder World (which is empty
 * in prod). Mirrors the lib/tars/graph-aws.ts pattern used by /infra: thin
 * server functions called directly by the server component so first paint needs
 * no client fetch.
 *
 * All durable runs today are pr-review (audit_log.workflow is 100% 'pr-review');
 * the other workflows come from the static registry with zeroed live stats so
 * their idleness is visible rather than absent.
 */

import { and, asc, desc, eq, gte, inArray, type SQL, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLog, prReviewRuns, webhookEvents } from "@/lib/db/tars-schema";
import { tarsJobs, workerHeartbeats } from "@/lib/db/worker-schema";
import {
  getWorkflowRegistry,
  type WorkflowDefinition,
} from "./workflow-registry";

/** A 'started' run idle longer than this is treated as stalled (silent failure). */
const STALL_THRESHOLD_MS = 15 * 60 * 1000;
/** Worker heartbeats older than this mark the executor as offline. */
const WORKER_OFFLINE_MS = 60 * 1000;
/** Trailing window for the per-workflow run sparkline. */
const SPARKLINE_DAYS = 14;

const TERMINAL_OK = new Set([
  "skipped-no-findings",
  "skipped-policy",
  "approved",
  "completed",
  "done",
]);
const NEEDS_HUMAN = new Set(["pending-approval", "disagreed"]);

export interface WorkflowFleetEntry extends WorkflowDefinition {
  isActive: boolean;
  runsTotal: number;
  runs24h: number;
  runs14d: { date: string; count: number }[];
  successRate: number | null;
  meanDurationMs: number | null;
  lastRunAt: string | null;
  pendingApproval: number;
  disagreed: number;
  errored: number;
  stalled: number;
}

export interface RunFeedRow {
  workflowKey: string;
  runId: string;
  owner: string;
  repo: string;
  prNumber: number;
  prSha: string | null;
  target: string;
  status: string;
  findingsCount: number;
  durationMs: number;
  prTitle: string | null;
  senderLogin: string | null;
  ageMs: number;
  isStalled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AttentionRun {
  runId: string;
  owner: string;
  repo: string;
  prNumber: number;
  findingsCount: number;
  ageMs: number;
  prTitle: string | null;
}

export interface WorkerHealth {
  online: boolean;
  workerId: string | null;
  version: string | null;
  hostname: string | null;
  lastSeenMs: number | null;
  uptimeMs: number | null;
}

export interface JobStats {
  byStatus: Record<string, number>;
  total: number;
  failed: number;
  failureRate: number;
  byKind: {
    kind: string;
    total: number;
    failed: number;
    avgDurationMs: number | null;
  }[];
  recentFailures: {
    id: string;
    kind: string;
    attempts: number;
    maxAttempts: number;
    errorText: string | null;
    createdAt: string;
  }[];
  stuck: number;
}

export interface ThroughputStats {
  windowDays: number;
  total: number;
  successRate: number;
  errorRate: number;
  disagreementRate: number;
  meanDurationMs: number;
  p95DurationMs: number;
  perDay: { date: string; count: number }[];
  perRepo: { repo: string; count: number }[];
}

export interface WorkflowOverview {
  fleet: WorkflowFleetEntry[];
  recentRuns: RunFeedRow[];
  attention: {
    stalled: AttentionRun[];
    pendingApproval: AttentionRun[];
    disagreed: AttentionRun[];
  };
  worker: WorkerHealth;
  jobs: JobStats;
  throughput: ThroughputStats;
  definedCount: number;
  activeCount: number;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function emptyDays(days: number): { date: string; count: number }[] {
  const out: { date: string; count: number }[] = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    out.push({ date: dayKey(new Date(now - i * 86_400_000)), count: 0 });
  }
  return out;
}

interface RawRun {
  runId: string;
  owner: string;
  repo: string;
  prNumber: number;
  prSha: string | null;
  status: string;
  findingsCount: number;
  createdAt: Date;
  updatedAt: Date;
}

function durationMs(r: { createdAt: Date; updatedAt: Date }): number {
  return Math.max(0, r.updatedAt.getTime() - r.createdAt.getTime());
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: breadth of independent branches/panels in one cohesive view-builder, not tangled control flow; splitting would scatter co-located UI logic
function buildPrReviewFleet(
  def: WorkflowDefinition,
  runs: RawRun[]
): WorkflowFleetEntry {
  const now = Date.now();
  const days = emptyDays(SPARKLINE_DAYS);
  const dayIndex = new Map(days.map((d, i) => [d.date, i]));

  let runsTotal = 0;
  let runs24h = 0;
  let pendingApproval = 0;
  let disagreed = 0;
  let errored = 0;
  let stalled = 0;
  let terminalCount = 0;
  let okCount = 0;
  let durationSum = 0;
  let durationN = 0;
  let lastRunAt: number | null = null;

  for (const r of runs) {
    runsTotal += 1;
    const created = r.createdAt.getTime();
    if (now - created < 86_400_000) {
      runs24h += 1;
    }
    if (lastRunAt === null || created > lastRunAt) {
      lastRunAt = created;
    }
    const idx = dayIndex.get(dayKey(r.createdAt));
    if (idx !== undefined) {
      days[idx].count += 1;
    }
    if (r.status === "pending-approval") {
      pendingApproval += 1;
    } else if (r.status === "disagreed") {
      disagreed += 1;
    } else if (r.status === "error") {
      errored += 1;
    } else if (
      r.status === "started" &&
      now - r.updatedAt.getTime() > STALL_THRESHOLD_MS
    ) {
      stalled += 1;
    }
    if (r.status !== "started" && r.status !== "error") {
      terminalCount += 1;
      if (TERMINAL_OK.has(r.status) || NEEDS_HUMAN.has(r.status)) {
        okCount += 1;
      }
      durationSum += durationMs(r);
      durationN += 1;
    }
  }

  let successRate: number | null = null;
  if (terminalCount > 0) {
    successRate = Math.round((okCount / terminalCount) * 1000) / 10;
  }
  let meanDurationMs: number | null = null;
  if (durationN > 0) {
    meanDurationMs = Math.round(durationSum / durationN);
  }

  return {
    ...def,
    isActive: runsTotal > 0,
    runsTotal,
    runs24h,
    runs14d: days,
    successRate,
    meanDurationMs,
    lastRunAt: lastRunAt === null ? null : new Date(lastRunAt).toISOString(),
    pendingApproval,
    disagreed,
    errored,
    stalled,
  };
}

function idleFleet(def: WorkflowDefinition): WorkflowFleetEntry {
  return {
    ...def,
    isActive: false,
    runsTotal: 0,
    runs24h: 0,
    runs14d: emptyDays(SPARKLINE_DAYS),
    successRate: null,
    meanDurationMs: null,
    lastRunAt: null,
    pendingApproval: 0,
    disagreed: 0,
    errored: 0,
    stalled: 0,
  };
}

/**
 * Whole-fleet overview for the /workflows landing page. One round of queries;
 * pr-review aggregates are computed from a single scan of all runs.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: breadth of independent branches/panels in one cohesive view-builder, not tangled control flow; splitting would scatter co-located UI logic
export async function getWorkflowOverview(
  windowDays = 7
): Promise<WorkflowOverview> {
  const since = new Date(Date.now() - windowDays * 86_400_000);

  const [allRuns, feedRows, workerRows, jobRows] = await Promise.all([
    db
      .select({
        runId: prReviewRuns.runId,
        owner: prReviewRuns.owner,
        repo: prReviewRuns.repo,
        prNumber: prReviewRuns.prNumber,
        prSha: prReviewRuns.prSha,
        status: prReviewRuns.status,
        findingsCount: prReviewRuns.findingsCount,
        createdAt: prReviewRuns.createdAt,
        updatedAt: prReviewRuns.updatedAt,
      })
      .from(prReviewRuns),
    db
      .select({
        runId: prReviewRuns.runId,
        owner: prReviewRuns.owner,
        repo: prReviewRuns.repo,
        prNumber: prReviewRuns.prNumber,
        prSha: prReviewRuns.prSha,
        status: prReviewRuns.status,
        findingsCount: prReviewRuns.findingsCount,
        createdAt: prReviewRuns.createdAt,
        updatedAt: prReviewRuns.updatedAt,
        prTitle: webhookEvents.prTitle,
        senderLogin: webhookEvents.senderLogin,
      })
      .from(prReviewRuns)
      .leftJoin(
        webhookEvents,
        eq(webhookEvents.triggeredRun, prReviewRuns.runId)
      )
      .orderBy(desc(prReviewRuns.updatedAt))
      .limit(25),
    db
      .select()
      .from(workerHeartbeats)
      .orderBy(desc(workerHeartbeats.lastSeen))
      .limit(1),
    db.select().from(tarsJobs),
  ]);

  const now = Date.now();

  // ── Fleet ────────────────────────────────────────────────────────────────
  const registry = getWorkflowRegistry();
  const prReviewRunsList = allRuns as RawRun[];
  const fleet = registry.map((def) => {
    if (def.auditWorkflow === "pr-review") {
      return buildPrReviewFleet(def, prReviewRunsList);
    }
    return idleFleet(def);
  });

  // ── Recent runs feed ───────────────────────────────────────────────────────
  const recentRuns: RunFeedRow[] = feedRows.map((r) => {
    const created = r.createdAt.getTime();
    const isStalled =
      r.status === "started" &&
      now - r.updatedAt.getTime() > STALL_THRESHOLD_MS;
    return {
      workflowKey: "pr-review",
      runId: r.runId,
      owner: r.owner,
      repo: r.repo,
      prNumber: r.prNumber,
      prSha: r.prSha,
      target: `${r.repo} #${r.prNumber}`,
      status: r.status,
      findingsCount: r.findingsCount,
      durationMs: durationMs(r),
      prTitle: r.prTitle,
      senderLogin: r.senderLogin,
      ageMs: now - created,
      isStalled,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  });

  // ── Attention buckets ──────────────────────────────────────────────────────
  const stalled: AttentionRun[] = [];
  const pendingApproval: AttentionRun[] = [];
  const disagreed: AttentionRun[] = [];
  for (const r of prReviewRunsList) {
    const base: AttentionRun = {
      runId: r.runId,
      owner: r.owner,
      repo: r.repo,
      prNumber: r.prNumber,
      findingsCount: r.findingsCount,
      ageMs: now - r.updatedAt.getTime(),
      prTitle: null,
    };
    if (
      r.status === "started" &&
      now - r.updatedAt.getTime() > STALL_THRESHOLD_MS
    ) {
      stalled.push(base);
    } else if (r.status === "pending-approval") {
      pendingApproval.push(base);
    } else if (r.status === "disagreed") {
      disagreed.push(base);
    }
  }
  const byAgeDesc = (a: AttentionRun, b: AttentionRun) => b.ageMs - a.ageMs;
  stalled.sort(byAgeDesc);
  pendingApproval.sort(byAgeDesc);
  disagreed.sort(byAgeDesc);

  // ── Worker health ──────────────────────────────────────────────────────────
  const w = workerRows[0];
  let worker: WorkerHealth;
  if (w) {
    const lastSeenMs = now - w.lastSeen.getTime();
    worker = {
      online: lastSeenMs < WORKER_OFFLINE_MS,
      workerId: w.workerId,
      version: w.version,
      hostname: w.hostname,
      lastSeenMs,
      uptimeMs: now - w.startedAt.getTime(),
    };
  } else {
    worker = {
      online: false,
      workerId: null,
      version: null,
      hostname: null,
      lastSeenMs: null,
      uptimeMs: null,
    };
  }

  // ── Job stats ──────────────────────────────────────────────────────────────
  const byStatus: Record<string, number> = {};
  const kindAgg = new Map<
    string,
    { total: number; failed: number; durSum: number; durN: number }
  >();
  let stuck = 0;
  const failures: JobStats["recentFailures"] = [];
  for (const j of jobRows) {
    byStatus[j.status] = (byStatus[j.status] ?? 0) + 1;
    const k = kindAgg.get(j.kind) ?? {
      total: 0,
      failed: 0,
      durSum: 0,
      durN: 0,
    };
    k.total += 1;
    if (j.status === "failed") {
      k.failed += 1;
      failures.push({
        id: j.id,
        kind: j.kind,
        attempts: j.attempts,
        maxAttempts: j.maxAttempts,
        errorText: j.errorText,
        createdAt: j.createdAt.toISOString(),
      });
    }
    if (j.startedAt && j.completedAt) {
      k.durSum += j.completedAt.getTime() - j.startedAt.getTime();
      k.durN += 1;
    }
    if (
      j.status === "running" &&
      j.lockedAt &&
      now - j.lockedAt.getTime() > STALL_THRESHOLD_MS
    ) {
      stuck += 1;
    }
    kindAgg.set(j.kind, k);
  }
  const failed = byStatus.failed ?? 0;
  const done = byStatus.done ?? 0;
  const failureRate =
    failed + done > 0 ? Math.round((failed / (failed + done)) * 1000) / 10 : 0;
  failures.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const jobs: JobStats = {
    byStatus,
    total: jobRows.length,
    failed,
    failureRate,
    byKind: [...kindAgg.entries()]
      .map(([kind, v]) => ({
        kind,
        total: v.total,
        failed: v.failed,
        avgDurationMs: v.durN > 0 ? Math.round(v.durSum / v.durN) : null,
      }))
      .sort((a, b) => b.total - a.total),
    recentFailures: failures.slice(0, 15),
    stuck,
  };

  // ── Throughput (windowed) ──────────────────────────────────────────────────
  const windowed = prReviewRunsList.filter((r) => r.createdAt >= since);
  const perDay = emptyDays(windowDays);
  const perDayIdx = new Map(perDay.map((d, i) => [d.date, i]));
  const perRepoMap = new Map<string, number>();
  const durations: number[] = [];
  let errors = 0;
  let disagreedN = 0;
  let okN = 0;
  let terminalN = 0;
  for (const r of windowed) {
    const di = perDayIdx.get(dayKey(r.createdAt));
    if (di !== undefined) {
      perDay[di].count += 1;
    }
    const repoKey = `${r.owner}/${r.repo}`;
    perRepoMap.set(repoKey, (perRepoMap.get(repoKey) ?? 0) + 1);
    if (r.status === "error") {
      errors += 1;
    }
    if (r.status === "disagreed") {
      disagreedN += 1;
    }
    if (r.status !== "started" && r.status !== "error") {
      terminalN += 1;
      durations.push(durationMs(r));
      if (TERMINAL_OK.has(r.status) || NEEDS_HUMAN.has(r.status)) {
        okN += 1;
      }
    }
  }
  durations.sort((a, b) => a - b);
  const total = windowed.length;
  let meanDuration = 0;
  if (durations.length > 0) {
    meanDuration = Math.round(
      durations.reduce((acc, d) => acc + d, 0) / durations.length
    );
  }
  let p95 = 0;
  if (durations.length > 0) {
    const idx = Math.min(
      durations.length - 1,
      Math.floor(durations.length * 0.95)
    );
    p95 = durations[idx];
  }

  const throughput: ThroughputStats = {
    windowDays,
    total,
    successRate: terminalN > 0 ? Math.round((okN / terminalN) * 1000) / 10 : 0,
    errorRate: total > 0 ? Math.round((errors / total) * 1000) / 10 : 0,
    disagreementRate:
      total > 0 ? Math.round((disagreedN / total) * 1000) / 10 : 0,
    meanDurationMs: meanDuration,
    p95DurationMs: p95,
    perDay,
    perRepo: [...perRepoMap.entries()]
      .map(([repo, count]) => ({ repo, count }))
      .sort((a, b) => b.count - a.count),
  };

  return {
    fleet,
    recentRuns,
    attention: { stalled, pendingApproval, disagreed },
    worker,
    jobs,
    throughput,
    definedCount: registry.length,
    activeCount: fleet.filter((f) => f.isActive).length,
  };
}

export interface TimelineStep {
  step: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  message: string | null;
  data: unknown;
}

export interface TimelineJob {
  id: string;
  kind: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  durationMs: number | null;
  errorText: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface RunTimeline {
  runId: string;
  workflowKey: string;
  owner: string;
  repo: string;
  prNumber: number;
  prSha: string | null;
  status: string;
  findingsCount: number;
  reviewCommentUrl: string | null;
  linearIssueUrl: string | null;
  linearIssueIdentifier: string | null;
  fixPrUrl: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  durationMs: number;
  prTitle: string | null;
  senderLogin: string | null;
  steps: TimelineStep[];
  jobs: TimelineJob[];
}

/**
 * Single-run durable timeline: the run row + its ordered audit_log steps
 * (each step's status events collapsed into start/end with a duration) + the
 * tars_jobs dispatched for it. Generalised so any workflow's audit trail
 * renders uniformly.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: breadth of independent branches/panels in one cohesive view-builder, not tangled control flow; splitting would scatter co-located UI logic
export async function getRunTimeline(
  runId: string
): Promise<RunTimeline | null> {
  const [runRows, auditRows, webhookRows, jobRows] = await Promise.all([
    db
      .select()
      .from(prReviewRuns)
      .where(eq(prReviewRuns.runId, runId))
      .limit(1),
    db
      .select()
      .from(auditLog)
      .where(eq(auditLog.runId, runId))
      .orderBy(asc(auditLog.createdAt)),
    db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.triggeredRun, runId))
      .limit(1),
    db
      .select()
      .from(tarsJobs)
      .where(sql`${tarsJobs.payload}->>'runId' = ${runId}`)
      .orderBy(asc(tarsJobs.createdAt)),
  ]);

  const run = runRows[0];
  if (!run) {
    return null;
  }
  const webhook = webhookRows[0] ?? null;
  const workflowKey =
    auditRows.find((a) => a.workflow)?.workflow ?? "pr-review";

  // Collapse audit rows into per-step start/end records keyed by step name.
  // A "start" status opens a step; the next non-start status for that step
  // closes it. Steps that only ever emit a terminal status are point events.
  const order: string[] = [];
  const steps = new Map<string, TimelineStep>();
  for (const a of auditRows) {
    const t = a.createdAt.getTime();
    const existing = steps.get(a.step);
    if (a.status === "start") {
      if (!existing) {
        order.push(a.step);
        steps.set(a.step, {
          step: a.step,
          status: "start",
          startedAt: a.createdAt.toISOString(),
          endedAt: null,
          durationMs: null,
          message: a.message,
          data: a.data,
        });
      }
      continue;
    }
    if (existing) {
      existing.status = a.status;
      existing.endedAt = a.createdAt.toISOString();
      existing.durationMs = Math.max(
        0,
        t - new Date(existing.startedAt).getTime()
      );
      if (a.message) {
        existing.message = a.message;
      }
      if (a.data) {
        existing.data = a.data;
      }
    } else {
      order.push(a.step);
      steps.set(a.step, {
        step: a.step,
        status: a.status,
        startedAt: a.createdAt.toISOString(),
        endedAt: a.createdAt.toISOString(),
        durationMs: 0,
        message: a.message,
        data: a.data,
      });
    }
  }

  const jobs: TimelineJob[] = jobRows.map((j) => {
    let dur: number | null = null;
    if (j.startedAt && j.completedAt) {
      dur = j.completedAt.getTime() - j.startedAt.getTime();
    }
    return {
      id: j.id,
      kind: j.kind,
      status: j.status,
      attempts: j.attempts,
      maxAttempts: j.maxAttempts,
      durationMs: dur,
      errorText: j.errorText,
      startedAt: j.startedAt?.toISOString() ?? null,
      completedAt: j.completedAt?.toISOString() ?? null,
    };
  });

  return {
    runId: run.runId,
    workflowKey,
    owner: run.owner,
    repo: run.repo,
    prNumber: run.prNumber,
    prSha: run.prSha,
    status: run.status,
    findingsCount: run.findingsCount,
    reviewCommentUrl: run.reviewCommentUrl,
    linearIssueUrl: run.linearIssueUrl,
    linearIssueIdentifier: run.linearIssueIdentifier,
    fixPrUrl: run.fixPrUrl,
    error: run.error,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    durationMs: durationMs(run),
    prTitle: webhook?.prTitle ?? null,
    senderLogin: webhook?.senderLogin ?? null,
    steps: order.map((s) => steps.get(s) as TimelineStep),
    jobs,
  };
}

export interface WorkflowRunsResult {
  runs: RunFeedRow[];
  total: number;
}

/** Filtered, paginated cross-workflow run feed (pr-review today). */
export async function getWorkflowRuns(opts: {
  status?: string[];
  repo?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
  offset?: number;
}): Promise<WorkflowRunsResult> {
  const conditions: SQL[] = [];
  if (opts.status && opts.status.length > 0) {
    conditions.push(inArray(prReviewRuns.status, opts.status));
  }
  if (opts.repo) {
    const [owner, repo] = opts.repo.includes("/")
      ? opts.repo.split("/", 2)
      : [null, opts.repo];
    if (owner) {
      conditions.push(eq(prReviewRuns.owner, owner));
    }
    if (repo) {
      conditions.push(eq(prReviewRuns.repo, repo));
    }
  }
  if (opts.from) {
    conditions.push(gte(prReviewRuns.createdAt, new Date(opts.from)));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const limit = Math.min(100, Math.max(1, opts.limit ?? 25));
  const offset = Math.max(0, opts.offset ?? 0);
  const now = Date.now();

  const [rows, countRows] = await Promise.all([
    db
      .select({
        runId: prReviewRuns.runId,
        owner: prReviewRuns.owner,
        repo: prReviewRuns.repo,
        prNumber: prReviewRuns.prNumber,
        prSha: prReviewRuns.prSha,
        status: prReviewRuns.status,
        findingsCount: prReviewRuns.findingsCount,
        createdAt: prReviewRuns.createdAt,
        updatedAt: prReviewRuns.updatedAt,
        prTitle: webhookEvents.prTitle,
        senderLogin: webhookEvents.senderLogin,
      })
      .from(prReviewRuns)
      .leftJoin(
        webhookEvents,
        eq(webhookEvents.triggeredRun, prReviewRuns.runId)
      )
      .where(where)
      .orderBy(desc(prReviewRuns.updatedAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(prReviewRuns)
      .where(where),
  ]);

  return {
    runs: rows.map((r) => ({
      workflowKey: "pr-review",
      runId: r.runId,
      owner: r.owner,
      repo: r.repo,
      prNumber: r.prNumber,
      prSha: r.prSha,
      target: `${r.repo} #${r.prNumber}`,
      status: r.status,
      findingsCount: r.findingsCount,
      durationMs: durationMs(r),
      prTitle: r.prTitle,
      senderLogin: r.senderLogin,
      ageMs: now - r.createdAt.getTime(),
      isStalled:
        r.status === "started" &&
        now - r.updatedAt.getTime() > STALL_THRESHOLD_MS,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
    total: countRows[0]?.count ?? 0,
  };
}
