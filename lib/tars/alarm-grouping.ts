/**
 * Shared AWS alarm / cost / service-health helpers.
 *
 * These were originally inlined in app/infra/page.tsx; the dashboard command
 * center needs the same severity-ranking + grouping logic for its attention
 * panel and domain-status strip, so they live here as a shared module that
 * both surfaces can import without duplicating the regex heuristics.
 *
 * Pure functions only (no React, no I/O) so they can be used from server
 * components, route handlers, and the dashboard aggregator alike.
 */

import type { OpsAccount } from "@/lib/tars/graph-aws";

const RE_TARGET_TRACKING = /^TargetTracking-/i;
const RE_ALARM_LOW = /AlarmLow/i;
const RE_ALARM_HIGH = /AlarmHigh/i;
const RE_UUID_SUFFIX = /-[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const RE_HEX_SUFFIX = /-[0-9a-f]{6,}$/i;
const RE_NUM_SUFFIX = /[-_]\d{6,}$/i;
const RE_SECURITY =
  /anomal|secret|root|unauthor|\biam\b|guardduty|threat|console|signin|login|access|breach/;
const RE_AUTOSCALE = /autoscal|scale-in|scale-out|targettracking/;

export type AlarmSeverity = "security" | "ops" | "info";

export interface FiringAlarm {
  name: string;
  reason: string;
}

export interface AlarmGroup {
  kind: string;
  severity: AlarmSeverity;
  count: number;
  samples: FiringAlarm[];
}

/** Collapse noisy alarm names into a human "kind" so dozens of firing alarms read as a handful of issues. */
export function alarmKind(name: string): string {
  if (RE_TARGET_TRACKING.test(name)) {
    if (RE_ALARM_LOW.test(name)) {
      return "ECS autoscaling · scale-in";
    }
    if (RE_ALARM_HIGH.test(name)) {
      return "ECS autoscaling · scale-out";
    }
    return "ECS autoscaling";
  }
  return name
    .replace(RE_UUID_SUFFIX, "")
    .replace(RE_HEX_SUFFIX, "")
    .replace(RE_NUM_SUFFIX, "");
}

export function alarmSeverity(kind: string): AlarmSeverity {
  const k = kind.toLowerCase();
  if (RE_SECURITY.test(k)) {
    return "security";
  }
  if (RE_AUTOSCALE.test(k)) {
    return "info";
  }
  return "ops";
}

const SEV_RANK: Record<AlarmSeverity, number> = {
  security: 0,
  ops: 1,
  info: 2,
};

export function groupAlarms(firing: FiringAlarm[]): AlarmGroup[] {
  const m = new Map<string, AlarmGroup>();
  for (const a of firing) {
    const kind = alarmKind(a.name);
    const g = m.get(kind) ?? {
      kind,
      severity: alarmSeverity(kind),
      count: 0,
      samples: [],
    };
    g.count += 1;
    if (g.samples.length < 6) {
      g.samples.push(a);
    }
    m.set(kind, g);
  }
  return [...m.values()].sort(
    (a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.count - a.count
  );
}

/** Count how many firing alarms in an account map to the "security" severity. */
export function securityFiringCount(firing: FiringAlarm[]): number {
  return groupAlarms(firing)
    .filter((g) => g.severity === "security")
    .reduce((m, g) => m + g.count, 0);
}

export function serviceHealthy(s: {
  running: number;
  desired: number;
  status: string;
}): boolean {
  return s.status === "ACTIVE" && s.running >= s.desired && s.desired > 0;
}

/** Sum each account's daily cost trend into one combined series. */
export function combinedTrend(
  accounts: OpsAccount[]
): { date: string; amount: number }[] {
  const m = new Map<string, number>();
  for (const acc of accounts) {
    for (const p of acc.costTrend ?? []) {
      m.set(p.date, (m.get(p.date) ?? 0) + p.amount);
    }
  }
  return [...m.entries()]
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date.localeCompare(b.date));
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
