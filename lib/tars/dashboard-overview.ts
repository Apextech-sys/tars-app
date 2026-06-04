/**
 * Dashboard command-center aggregator.
 *
 * Server-side only. Fans out to every live domain (PR-review DB, AWS ops,
 * Temporal, knowledge graph, inbox attention queue, worker heartbeats) in
 * parallel and returns ONE normalized payload so the dashboard does not have
 * to make 6 separate slow client fetches.
 *
 * Every domain degrades gracefully to `available:false` rather than throwing,
 * so a single slow/offline backend never blanks the whole command center.
 * The expensive /aws/ops boto3 fan-out (~25s) is isolated behind its own
 * timeout in lib/tars/graph-aws.ts and only affects the AWS card if slow.
 */

import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { prReviewRuns } from "@/lib/db/tars-schema";
import { tarsJobs, workerHeartbeats } from "@/lib/db/worker-schema";
import {
  type AlarmSeverity,
  groupAlarms,
  securityFiringCount,
  serviceHealthy,
} from "@/lib/tars/alarm-grouping";
import { getOps } from "@/lib/tars/graph-aws";
import { getGraphStats } from "@/lib/tars/graph-explore";
import { getTemporal } from "@/lib/tars/graph-temporal";

const MS_PER_MIN = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MIN;
const STALL_MINUTES = 5;

export type AttentionSeverity = "blocker" | "warn" | "info";

export interface AttentionAction {
  label: string;
  /** server-action key the client maps to a handler; only "approve"/"reject" wired today */
  kind: "approve" | "reject";
}

export interface Finding {
  file: string;
  line: number | null;
  severity: string;
  category: string | null;
  message: string;
  suggestion: string | null;
}

export interface AttentionItem {
  id: string;
  kind: string;
  severity: AttentionSeverity;
  title: string;
  context: string;
  /** seconds since the item was created (for age / oldest-waiting) */
  ageMs: number;
  /** internal TARS drill-in */
  href: string;
  /** secondary external deep-link (GitHub PR), when derivable */
  externalHref: string | null;
  runId: string | null;
  /** present on pending-approval items so the panel can act inline */
  approvableRunId: string | null;
  findings: Finding[];
}

export interface PrDomain {
  available: boolean;
  inFlight: number;
  pendingApproval: number;
  disagreed: number;
  fixActive: number;
  errored: number;
  errorRate: number;
  disagreementRate: number;
  meanReviewMs: number;
  total: number;
  windowDays: number;
  statusHistogram: { status: string; count: number }[];
}

export interface AwsAccountSummary {
  label: string;
  accountId: string;
  healthy: number;
  totalSvc: number;
  firing: number;
  securityFiring: number;
  rdsCount: number;
  rdsUnhealthy: number;
  costTrend: { date: string; amount: number }[];
}

export interface AwsDomain {
  available: boolean;
  accounts: AwsAccountSummary[];
  healthy: number;
  totalSvc: number;
  totalFiring: number;
  securityFiring: number;
  degraded: number;
  rdsUnhealthy: number;
  costYesterday: number;
  costDelta: number;
  currency: string;
  securityGroups: { kind: string; count: number; severity: AlarmSeverity }[];
}

export interface TemporalDomain {
  available: boolean;
  namespace: string;
  running: number;
  failed: number;
  completed: number;
  terminated: number;
}

export interface GraphDomain {
  available: boolean;
  totalNodes: number;
  totalEdges: number;
  nodes: { type: string; count: number }[];
  edges: { type: string; count: number }[];
}

export interface WorkersDomain {
  available: boolean;
  total: number;
  green: number;
  amber: number;
  red: number;
  newestSeenMs: number | null;
}

export interface DashboardOverview {
  generatedAt: string;
  attentionItems: AttentionItem[];
  attentionCounts: { blocker: number; warn: number; info: number };
  criticalFindings: number;
  oldestWaitingMs: number | null;
  domains: {
    pr: PrDomain;
    aws: AwsDomain;
    temporal: TemporalDomain;
    graph: GraphDomain;
    workers: WorkersDomain;
  };
}

const COMPLETED_STATUSES = new Set([
  "completed",
  "skipped-no-findings",
  "disagreed",
  "pending-approval",
  "approved",
  "rejected",
  "error",
  "blocked-konverge",
  "skipped-policy",
  "fixing",
  "fix-in-review",
  "fix-failed",
  "done",
]);

const GITHUB_BASE = "https://github.com";

function githubPrUrl(
  owner: string,
  repo: string,
  prNumber: number
): string | null {
  if (!(owner && repo && prNumber)) {
    return null;
  }
  return `${GITHUB_BASE}/${owner}/${repo}/pull/${prNumber}`;
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  blocker: 0,
  high: 1,
  major: 1,
  medium: 2,
  minor: 3,
  low: 3,
  info: 4,
};

function maxFindingSeverity(findings: Finding[]): string | null {
  let best: string | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const f of findings) {
    const rank = SEVERITY_RANK[f.severity?.toLowerCase()] ?? 5;
    if (rank < bestRank) {
      bestRank = rank;
      best = f.severity?.toLowerCase() ?? null;
    }
  }
  return best;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: breadth of independent branches/panels in one cohesive view-builder, not tangled control flow; splitting would scatter co-located UI logic
function normalizeFindings(raw: unknown): Finding[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: Finding[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") {
      continue;
    }
    const o = r as Record<string, unknown>;
    let message = "";
    if (typeof o.message === "string") {
      message = o.message;
    } else if (typeof o.title === "string") {
      message = o.title;
    }
    out.push({
      file: typeof o.file === "string" ? o.file : "",
      line: typeof o.line === "number" ? o.line : null,
      severity: typeof o.severity === "string" ? o.severity : "info",
      category: typeof o.category === "string" ? o.category : null,
      message,
      suggestion: typeof o.suggestion === "string" ? o.suggestion : null,
    });
  }
  return out;
}

const ATTENTION_RANK: Record<AttentionSeverity, number> = {
  blocker: 0,
  warn: 1,
  info: 2,
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: breadth of independent branches/panels in one cohesive view-builder, not tangled control flow; splitting would scatter co-located UI logic
async function buildPrDomain(): Promise<{
  domain: PrDomain;
  attention: AttentionItem[];
  criticalFindings: number;
}> {
  const windowDays = 7;
  const since = new Date(Date.now() - windowDays * MS_PER_DAY);
  const stallThreshold = new Date(Date.now() - STALL_MINUTES * MS_PER_MIN);

  const [recent, pending, disagreedRows, stalled, erroredRows] =
    await Promise.all([
      db
        .select({
          status: prReviewRuns.status,
          createdAt: prReviewRuns.createdAt,
          updatedAt: prReviewRuns.updatedAt,
        })
        .from(prReviewRuns)
        .where(gte(prReviewRuns.createdAt, since)),
      db
        .select()
        .from(prReviewRuns)
        .where(eq(prReviewRuns.status, "pending-approval"))
        .orderBy(sql`${prReviewRuns.createdAt} ASC`)
        .limit(50),
      db
        .select()
        .from(prReviewRuns)
        .where(eq(prReviewRuns.status, "disagreed"))
        .orderBy(sql`${prReviewRuns.createdAt} ASC`)
        .limit(50),
      db
        .select()
        .from(prReviewRuns)
        .where(
          and(
            eq(prReviewRuns.status, "started"),
            lt(prReviewRuns.createdAt, stallThreshold)
          )
        )
        .limit(50),
      db
        .select()
        .from(prReviewRuns)
        .where(sql`${prReviewRuns.error} IS NOT NULL`)
        .orderBy(sql`${prReviewRuns.createdAt} DESC`)
        .limit(50),
    ]);

  const total = recent.length;
  const errors = recent.filter((r) => r.status === "error").length;
  const disagreedCount = recent.filter((r) => r.status === "disagreed").length;
  const inFlight = recent.filter((r) => r.status === "started").length;
  const completed = recent.filter((r) => COMPLETED_STATUSES.has(r.status));
  const fixActive = recent.filter((r) =>
    ["fixing", "fix-in-review"].includes(r.status)
  ).length;

  let meanReviewMs = 0;
  if (completed.length > 0) {
    const sum = completed.reduce(
      (acc, r) => acc + (r.updatedAt.getTime() - r.createdAt.getTime()),
      0
    );
    meanReviewMs = sum / completed.length;
  }

  const histMap = new Map<string, number>();
  for (const r of recent) {
    histMap.set(r.status, (histMap.get(r.status) ?? 0) + 1);
  }
  const statusHistogram = [...histMap.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);

  const now = Date.now();
  const attention: AttentionItem[] = [];
  let criticalFindings = 0;

  for (const r of pending) {
    const findings = normalizeFindings(r.agreedFindings);
    const maxSev = maxFindingSeverity(findings);
    const isCritical = maxSev === "critical" || maxSev === "blocker";
    if (isCritical) {
      criticalFindings += 1;
    }
    const sev: AttentionSeverity = isCritical ? "blocker" : "warn";
    const critTag = isCritical ? " · 1 critical" : "";
    attention.push({
      id: `prapp-${r.runId}`,
      kind: "pr_pending_approval",
      severity: sev,
      title: `Approve review · ${r.owner}/${r.repo} #${r.prNumber}`,
      context: `${findings.length || r.findingsCount} agreed finding${
        (findings.length || r.findingsCount) === 1 ? "" : "s"
      }${critTag}`,
      ageMs: now - r.createdAt.getTime(),
      href: `/pr-runs/${encodeURIComponent(r.runId)}`,
      externalHref: githubPrUrl(r.owner, r.repo, r.prNumber),
      runId: r.runId,
      approvableRunId: r.runId,
      findings,
    });
  }

  for (const r of disagreedRows) {
    const payload = r.disagreedPayload as {
      codex?: { findings?: unknown[] };
      claude?: { findings?: unknown[] };
      overlapRatio?: number;
    } | null;
    const codexN = payload?.codex?.findings?.length ?? 0;
    const claudeN = payload?.claude?.findings?.length ?? 0;
    const overlap =
      typeof payload?.overlapRatio === "number" ? payload.overlapRatio : null;
    const overlapTag =
      overlap === null ? "" : ` · ${Math.round(overlap * 100)}% overlap`;
    attention.push({
      id: `prdis-${r.runId}`,
      kind: "pr_disagreement",
      severity: "warn",
      title: `Adjudicate · ${r.owner}/${r.repo} #${r.prNumber}`,
      context: `Codex ${codexN} vs Claude ${claudeN}${overlapTag}`,
      ageMs: now - r.createdAt.getTime(),
      href: `/pr-runs/${encodeURIComponent(r.runId)}`,
      externalHref: githubPrUrl(r.owner, r.repo, r.prNumber),
      runId: r.runId,
      approvableRunId: null,
      findings: [],
    });
  }

  for (const r of erroredRows) {
    attention.push({
      id: `prerr-${r.runId}`,
      kind: "pr_failure",
      severity: "blocker",
      title: `Errored run · ${r.owner}/${r.repo} #${r.prNumber}`,
      context: (r.error ?? "unknown error").slice(0, 140),
      ageMs: now - r.createdAt.getTime(),
      href: `/pr-runs/${encodeURIComponent(r.runId)}`,
      externalHref: githubPrUrl(r.owner, r.repo, r.prNumber),
      runId: r.runId,
      approvableRunId: null,
      findings: [],
    });
  }

  for (const r of stalled) {
    const ageMin = Math.round((now - r.createdAt.getTime()) / MS_PER_MIN);
    attention.push({
      id: `stall-${r.runId}`,
      kind: "workflow_stall",
      severity: "warn",
      title: `Stalled run · ${r.owner}/${r.repo} #${r.prNumber}`,
      context: `started ${ageMin}m ago, still running`,
      ageMs: now - r.createdAt.getTime(),
      href: `/pr-runs/${encodeURIComponent(r.runId)}`,
      externalHref: githubPrUrl(r.owner, r.repo, r.prNumber),
      runId: r.runId,
      approvableRunId: null,
      findings: [],
    });
  }

  const errorRate = total > 0 ? Math.round((errors / total) * 1000) / 10 : 0;
  const disagreementRate =
    total > 0 ? Math.round((disagreedCount / total) * 1000) / 10 : 0;

  return {
    domain: {
      available: true,
      inFlight,
      pendingApproval: pending.length,
      disagreed: disagreedRows.length,
      fixActive,
      errored: erroredRows.length,
      errorRate,
      disagreementRate,
      meanReviewMs,
      total,
      windowDays,
      statusHistogram,
    },
    attention,
    criticalFindings,
  };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: breadth of independent branches/panels in one cohesive view-builder, not tangled control flow; splitting would scatter co-located UI logic
async function buildWorkerAttention(): Promise<{
  domain: WorkersDomain;
  attention: AttentionItem[];
}> {
  const liveThreshold = new Date(Date.now() - 120_000);
  const now = Date.now();
  const [live, failedJobs] = await Promise.all([
    db
      .select()
      .from(workerHeartbeats)
      .where(gte(workerHeartbeats.lastSeen, liveThreshold)),
    db
      .select()
      .from(tarsJobs)
      .where(
        and(
          eq(tarsJobs.status, "failed"),
          gte(tarsJobs.createdAt, new Date(now - 7 * MS_PER_DAY))
        )
      ),
  ]);

  let green = 0;
  let amber = 0;
  let red = 0;
  let newestSeenMs: number | null = null;
  for (const w of live) {
    const age = now - w.lastSeen.getTime();
    if (newestSeenMs === null || age < newestSeenMs) {
      newestSeenMs = age;
    }
    if (age < 60_000) {
      green += 1;
    } else if (age < 300_000) {
      amber += 1;
    } else {
      red += 1;
    }
  }

  const attention: AttentionItem[] = [];
  if (failedJobs.length > 0) {
    const byKind = new Map<string, { count: number; newest: number }>();
    for (const j of failedJobs) {
      const g = byKind.get(j.kind) ?? { count: 0, newest: 0 };
      g.count += 1;
      g.newest = Math.max(g.newest, j.createdAt.getTime());
      byKind.set(j.kind, g);
    }
    for (const [kind, g] of byKind.entries()) {
      attention.push({
        id: `jobs-${kind}`,
        kind: "worker_failure",
        severity: "info",
        title: `Worker failures · ${kind}`,
        context: `${g.count} failed job${g.count === 1 ? "" : "s"} (7d)`,
        ageMs: now - g.newest,
        href: "/inbox",
        externalHref: null,
        runId: null,
        approvableRunId: null,
        findings: [],
      });
    }
  }

  return {
    domain: {
      available: true,
      total: live.length,
      green,
      amber,
      red,
      newestSeenMs,
    },
    attention,
  };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: breadth of independent branches/panels in one cohesive view-builder, not tangled control flow; splitting would scatter co-located UI logic
function buildAwsDomain(ops: Awaited<ReturnType<typeof getOps>>): {
  domain: AwsDomain;
  attention: AttentionItem[];
} {
  const accounts = ops.accounts ?? [];
  const accountSummaries: AwsAccountSummary[] = accounts.map((a) => {
    const services = a.services ?? [];
    const rds = a.rds ?? [];
    return {
      label: a.label,
      accountId: a.accountId,
      healthy: services.filter(serviceHealthy).length,
      totalSvc: services.length,
      firing: a.alarms?.ALARM ?? 0,
      securityFiring: securityFiringCount(a.alarms?.firing ?? []),
      rdsCount: rds.length,
      rdsUnhealthy: rds.filter((r) => r.status.toLowerCase() !== "available")
        .length,
      costTrend: a.costTrend ?? [],
    };
  });

  const allServices = accounts.flatMap((a) => a.services ?? []);
  const healthy = allServices.filter(serviceHealthy).length;
  const degraded = allServices.length - healthy;
  const allRds = accounts.flatMap((a) => a.rds ?? []);
  const rdsUnhealthy = allRds.filter(
    (r) => r.status.toLowerCase() !== "available"
  ).length;
  const totalFiring = accounts.reduce((n, a) => n + (a.alarms?.ALARM ?? 0), 0);
  const securityFiring = accounts.reduce(
    (n, a) => n + securityFiringCount(a.alarms?.firing ?? []),
    0
  );

  // combined daily cost across accounts
  const costMap = new Map<string, number>();
  for (const a of accounts) {
    for (const p of a.costTrend ?? []) {
      costMap.set(p.date, (costMap.get(p.date) ?? 0) + p.amount);
    }
  }
  const trend = [...costMap.entries()]
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const latest = trend.at(-1);
  const prev = trend.at(-2);
  const costYesterday = latest?.amount ?? 0;
  const costDelta = latest && prev ? latest.amount - prev.amount : 0;

  // security alarm groups across all accounts (for the attention panel)
  const groupMap = new Map<
    string,
    { kind: string; count: number; severity: AlarmSeverity }
  >();
  for (const a of accounts) {
    for (const g of groupAlarms(a.alarms?.firing ?? [])) {
      if (g.severity !== "security") {
        continue;
      }
      const existing = groupMap.get(g.kind) ?? {
        kind: g.kind,
        count: 0,
        severity: g.severity,
      };
      existing.count += g.count;
      groupMap.set(g.kind, existing);
    }
  }
  const securityGroups = [...groupMap.values()].sort(
    (a, b) => b.count - a.count
  );

  const attention: AttentionItem[] = [];
  for (const g of securityGroups) {
    attention.push({
      id: `aws-sec-${g.kind}`,
      kind: "aws_security_alarm",
      severity: "blocker",
      title: `Security alarm · ${g.kind}`,
      context: `${g.count} firing`,
      ageMs: 0,
      href: "/infra",
      externalHref: null,
      runId: null,
      approvableRunId: null,
      findings: [],
    });
  }
  for (const a of accountSummaries) {
    const deg = a.totalSvc - a.healthy;
    if (deg > 0) {
      attention.push({
        id: `aws-svc-${a.accountId}`,
        kind: "aws_service_degraded",
        severity: "blocker",
        title: `Degraded services · ${a.label}`,
        context: `${deg} ECS service${deg === 1 ? "" : "s"} below desired`,
        ageMs: 0,
        href: "/infra",
        externalHref: null,
        runId: null,
        approvableRunId: null,
        findings: [],
      });
    }
  }

  return {
    domain: {
      available: ops.available,
      accounts: accountSummaries,
      healthy,
      totalSvc: allServices.length,
      totalFiring,
      securityFiring,
      degraded,
      rdsUnhealthy,
      costYesterday,
      costDelta,
      currency: "USD",
      securityGroups,
    },
    attention,
  };
}

function buildTemporalDomain(
  temporal: Awaited<ReturnType<typeof getTemporal>>
): TemporalDomain {
  const c = temporal.counts ?? {};
  return {
    available: temporal.available,
    namespace: temporal.namespace,
    running: c.running ?? 0,
    failed: c.failed ?? 0,
    completed: c.completed ?? 0,
    terminated: c.terminated ?? 0,
  };
}

export async function buildOverview(): Promise<DashboardOverview> {
  const [prResult, workerResult, ops, temporalView, graphStats] =
    await Promise.all([
      buildPrDomain(),
      buildWorkerAttention(),
      getOps(),
      getTemporal(),
      getGraphStats(),
    ]);

  const awsResult = buildAwsDomain(ops);
  const temporal = buildTemporalDomain(temporalView);

  const attentionItems = [
    ...prResult.attention,
    ...awsResult.attention,
    ...workerResult.attention,
  ].sort((a, b) => {
    const rank = ATTENTION_RANK[a.severity] - ATTENTION_RANK[b.severity];
    if (rank !== 0) {
      return rank;
    }
    return b.ageMs - a.ageMs;
  });

  const attentionCounts = { blocker: 0, warn: 0, info: 0 };
  let oldestWaitingMs: number | null = null;
  for (const item of attentionItems) {
    attentionCounts[item.severity] += 1;
    if (
      item.ageMs > 0 &&
      (oldestWaitingMs === null || item.ageMs > oldestWaitingMs)
    ) {
      oldestWaitingMs = item.ageMs;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    attentionItems,
    attentionCounts,
    criticalFindings: prResult.criticalFindings,
    oldestWaitingMs,
    domains: {
      pr: prResult.domain,
      aws: awsResult.domain,
      temporal,
      graph: {
        available: graphStats.available,
        totalNodes: graphStats.totalNodes,
        totalEdges: graphStats.totalEdges,
        nodes: graphStats.nodes,
        edges: graphStats.edges,
      },
      workers: workerResult.domain,
    },
  };
}
