/**
 * Client-side mirror of the /api/tars/dashboard/overview + /feed response
 * shapes. Declared independently of lib/tars/dashboard-overview.ts so the
 * client bundle never pulls in the server-only aggregator (which imports the
 * drizzle db handle).
 */

export type AttentionSeverity = "blocker" | "warn" | "info";

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
  ageMs: number;
  href: string;
  externalHref: string | null;
  runId: string | null;
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
  securityGroups: { kind: string; count: number; severity: string }[];
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

export interface ActivityBucket {
  hour: string;
  completed: number;
  error: number;
  blocked: number;
  disagreed: number;
  started: number;
  skipped: number;
}

export interface FeedRow {
  id: number;
  runId: string;
  workflow: string;
  step: string;
  status: string;
  owner: string | null;
  repo: string | null;
  prNumber: number | null;
  message: string | null;
  prTitle: string | null;
  createdAt: string;
}

export function formatMs(ms: number): string {
  if (ms <= 0) {
    return "—";
  }
  const s = ms / 1000;
  if (s < 60) {
    return `${s.toFixed(1)}s`;
  }
  const m = s / 60;
  if (m < 60) {
    return `${m.toFixed(0)}m`;
  }
  const h = m / 60;
  if (h < 24) {
    return `${h.toFixed(1)}h`;
  }
  return `${(h / 24).toFixed(1)}d`;
}

export function relativeAge(ms: number): string {
  if (ms <= 0) {
    return "just now";
  }
  const s = Math.floor(ms / 1000);
  if (s < 60) {
    return `${s}s`;
  }
  const m = Math.floor(s / 60);
  if (m < 60) {
    return `${m}m`;
  }
  const h = Math.floor(m / 60);
  if (h < 24) {
    return `${h}h`;
  }
  const d = Math.floor(h / 24);
  const rem = h % 24;
  return rem > 0 ? `${d}d ${rem}h` : `${d}d`;
}

export function relativeTimeFromIso(iso: string): string {
  return `${relativeAge(Date.now() - new Date(iso).getTime())} ago`;
}

export function money(n: number, ccy = "USD", compact = false): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: ccy || "USD",
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: compact ? 1 : 2,
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}
