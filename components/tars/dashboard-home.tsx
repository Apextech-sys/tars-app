"use client";

import {
  AlertCircle,
  ArrowRight,
  Bot,
  Clock,
  GitPullRequest,
  RefreshCw,
  TrendingUp,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) {
    return "Good morning";
  }
  if (h < 17) {
    return "Good afternoon";
  }
  return "Good evening";
}

function formatMs(ms: number): string {
  if (ms === 0) {
    return "—";
  }
  const s = ms / 1000;
  if (s < 60) {
    return `${s.toFixed(1)}s`;
  }
  const m = s / 60;
  if (m < 60) {
    return `${m.toFixed(1)}m`;
  }
  return `${(m / 60).toFixed(1)}h`;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) {
    return `${s}s ago`;
  }
  const m = Math.floor(s / 60);
  if (m < 60) {
    return `${m}m ago`;
  }
  const h = Math.floor(m / 60);
  if (h < 24) {
    return `${h}h ago`;
  }
  return `${Math.floor(h / 24)}d ago`;
}

const STATUS_COLORS: Record<string, string> = {
  started: "bg-blue-500/10 text-blue-400 border border-blue-500/30",
  completed: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30",
  "skipped-no-findings": "bg-zinc-500/10 text-zinc-400 border border-zinc-700",
  "skipped-policy": "bg-zinc-500/10 text-zinc-400 border border-zinc-700",
  "blocked-konverge":
    "bg-amber-500/10 text-amber-400 border border-amber-500/30",
  disagreed: "bg-purple-500/10 text-purple-400 border border-purple-500/30",
  error: "bg-red-500/10 text-red-400 border border-red-500/30",
};

function StatusChip({ status }: { status: string }) {
  const cls =
    STATUS_COLORS[status] ??
    "bg-zinc-500/10 text-zinc-400 border border-zinc-700";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 font-medium text-xs uppercase tracking-wide",
        cls
      )}
    >
      {status}
    </span>
  );
}

interface StatsData {
  inFlight: number;
  errorRate: number;
  disagreementRate: number;
  meanReviewMs: number;
  total: number;
  windowDays: number;
}

interface ActivityBucket {
  hour: string;
  completed: number;
  error: number;
  blocked: number;
  disagreed: number;
  started: number;
  skipped: number;
}

interface RunRow {
  runId: string;
  owner: string;
  repo: string;
  prNumber: number;
  status: string;
  findingsCount: number;
  updatedAt: string;
  prTitle: string | null;
}

interface WorkerData {
  workerId: string;
  lastSeen: string;
  ageSeconds: number;
  healthStatus: "green" | "amber" | "red";
  hostname: string | null;
  version: string | null;
}

// Inline SVG bar chart — no external charting lib needed
function ActivitySparkline({ buckets }: { buckets: ActivityBucket[] }) {
  const maxVal = Math.max(
    1,
    ...buckets.map(
      (b) =>
        b.completed + b.error + b.blocked + b.disagreed + b.started + b.skipped
    )
  );

  const recent = buckets.slice(-24);

  return (
    <div className="space-y-2">
      <div className="flex h-16 items-end gap-0.5">
        {recent.map((b, _i) => {
          const total =
            b.completed +
            b.error +
            b.blocked +
            b.disagreed +
            b.started +
            b.skipped;
          const heightPct = (total / maxVal) * 100;

          // Stacked: completed (green), blocked (amber), disagreed (purple), error (red), started (blue)
          const completedPct = total > 0 ? (b.completed / total) * 100 : 0;
          const blockedPct = total > 0 ? (b.blocked / total) * 100 : 0;
          const disagreedPct = total > 0 ? (b.disagreed / total) * 100 : 0;
          const errorPct = total > 0 ? (b.error / total) * 100 : 0;

          return (
            <div
              className="group relative flex flex-1 flex-col justify-end"
              key={b.hour}
              title={`${new Date(b.hour).getUTCHours()}:00 — ${total} runs`}
            >
              <div
                className="flex w-full flex-col-reverse overflow-hidden rounded-sm transition-all"
                style={{ height: `${Math.max(heightPct, total > 0 ? 8 : 2)}%` }}
              >
                <div
                  className="bg-emerald-500/70"
                  style={{ height: `${completedPct}%` }}
                />
                <div
                  className="bg-amber-500/70"
                  style={{ height: `${blockedPct}%` }}
                />
                <div
                  className="bg-purple-500/70"
                  style={{ height: `${disagreedPct}%` }}
                />
                <div
                  className="bg-red-500/70"
                  style={{ height: `${errorPct}%` }}
                />
              </div>
              {/* Tooltip */}
              <div className="absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded border border-border bg-popover px-2 py-1 text-xs shadow-lg group-hover:block">
                {new Date(b.hour).getUTCHours()}:00 — {total}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-muted-foreground text-xs">
        <span>24h ago</span>
        <span>now</span>
      </div>
    </div>
  );
}

function WorkerStrip({ workers }: { workers: WorkerData[] }) {
  if (workers.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card/30 p-3 text-muted-foreground text-sm">
        <WifiOff className="size-4" />
        <span>No heartbeat data</span>
        <span className="ml-auto text-xs">
          Worker should POST to{" "}
          <code className="rounded bg-muted px-1 font-mono text-xs">
            /api/tars/worker/heartbeat
          </code>
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {workers.map((w) => (
        <div
          className={cn(
            "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
            w.healthStatus === "green"
              ? "border-emerald-500/30 bg-emerald-500/5"
              : w.healthStatus === "amber"
                ? "border-amber-500/30 bg-amber-500/5"
                : "border-red-500/30 bg-red-500/5"
          )}
          key={w.workerId}
        >
          {w.healthStatus === "green" ? (
            <Wifi
              aria-label="Worker healthy"
              className="size-3.5 text-emerald-400"
            />
          ) : w.healthStatus === "amber" ? (
            <Wifi
              aria-label="Worker degraded"
              className="size-3.5 text-amber-400"
            />
          ) : (
            <WifiOff
              aria-label="Worker offline"
              className="size-3.5 text-red-400"
            />
          )}
          <div>
            <p className="font-medium text-xs">{w.workerId}</p>
            <p className="text-muted-foreground text-xs">
              {relativeTime(w.lastSeen)}
              {w.hostname ? ` · ${w.hostname}` : ""}
              {w.version ? ` · v${w.version}` : ""}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function DashboardHome() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [activity, setActivity] = useState<ActivityBucket[]>([]);
  const [recentRuns, setRecentRuns] = useState<RunRow[]>([]);
  const [workers, setWorkers] = useState<WorkerData[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadAll() {
    setLoading(true);
    try {
      const [statsRes, activityRes, runsRes, workersRes] = await Promise.all([
        fetch("/api/tars/dashboard/stats?window=7d").then((r) => r.json()),
        fetch("/api/tars/dashboard/activity?hours=24").then((r) => r.json()),
        fetch("/api/tars/pr-runs?limit=10&offset=0").then((r) => r.json()),
        fetch("/api/tars/worker/heartbeats").then((r) => r.json()),
      ]);

      setStats(statsRes as StatsData);
      setActivity((activityRes as { buckets: ActivityBucket[] }).buckets ?? []);
      setRecentRuns(((runsRes as { runs: RunRow[] }).runs ?? []) as RunRow[]);
      setWorkers((workersRes as { workers: WorkerData[] }).workers ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // Refresh every 60s
    const interval = setInterval(loadAll, 60_000);
    return () => clearInterval(interval);
  }, []);

  const errorRateColor = stats
    ? stats.errorRate < 5
      ? "text-emerald-400"
      : stats.errorRate < 15
        ? "text-amber-400"
        : "text-red-400"
    : "";

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 md:py-8">
        {/* Hero */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-semibold text-2xl md:text-3xl">
              {getGreeting()}, Shaun
            </h1>
            <p className="mt-1 text-muted-foreground text-sm">
              {new Date().toLocaleDateString("en-ZA", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>
          </div>
          <button
            aria-label="Refresh dashboard"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-muted-foreground text-sm transition-colors hover:bg-accent hover:text-foreground"
            onClick={loadAll}
            type="button"
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            Refresh
          </button>
        </div>

        {/* KPI Grid */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {/* Runs in flight */}
          <div className="space-y-2 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
              <Zap className="size-3.5" />
              In Flight
            </div>
            <div className="flex items-end gap-2">
              <span
                className={cn(
                  "font-bold text-3xl",
                  stats
                    ? stats.inFlight > 0
                      ? "text-amber-400"
                      : "text-emerald-400"
                    : "text-muted-foreground"
                )}
              >
                {stats?.inFlight ?? "—"}
              </span>
            </div>
            <p className="text-muted-foreground text-xs">
              {stats?.inFlight === 0
                ? "All clear"
                : stats
                  ? "Active runs"
                  : "Loading..."}
            </p>
            {stats?.inFlight && stats.inFlight > 0 ? (
              <Link
                className="text-primary text-xs hover:underline"
                href="/pr-runs?status=started"
              >
                View active →
              </Link>
            ) : null}
          </div>

          {/* Error rate */}
          <div className="space-y-2 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
              <AlertCircle className="size-3.5" />
              Error Rate (7d)
            </div>
            <div className="flex items-end gap-1">
              <span className={cn("font-bold text-3xl", errorRateColor)}>
                {stats ? `${stats.errorRate}%` : "—"}
              </span>
            </div>
            <p className="text-muted-foreground text-xs">
              {stats ? `${stats.total} runs total` : "Loading..."}
            </p>
          </div>

          {/* Mean review time */}
          <div className="space-y-2 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
              <Clock className="size-3.5" />
              Mean Review (7d)
            </div>
            <div>
              <span className="font-bold text-3xl">
                {stats ? formatMs(stats.meanReviewMs) : "—"}
              </span>
            </div>
            <p className="text-muted-foreground text-xs">avg duration</p>
          </div>

          {/* Disagreement rate */}
          <div className="space-y-2 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
              <TrendingUp className="size-3.5" />
              Disagreement (7d)
            </div>
            <div>
              <span
                className={cn(
                  "font-bold text-3xl",
                  stats
                    ? stats.disagreementRate > 20
                      ? "text-red-400"
                      : stats.disagreementRate > 10
                        ? "text-amber-400"
                        : "text-foreground"
                    : ""
                )}
              >
                {stats ? `${stats.disagreementRate}%` : "—"}
              </span>
            </div>
            <p className="text-muted-foreground text-xs">Codex vs Claude</p>
          </div>
        </div>

        {/* Worker heartbeat strip */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Bot className="size-4 text-muted-foreground" />
            <h2 className="font-semibold text-sm">Worker Status</h2>
          </div>
          <WorkerStrip workers={workers} />
        </div>

        {/* Activity sparkline */}
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="size-4 text-muted-foreground" />
              <h2 className="font-semibold text-sm">Activity — last 24h</h2>
            </div>
            <div className="flex items-center gap-3 text-muted-foreground text-xs">
              <span className="flex items-center gap-1">
                <span className="inline-block size-2 rounded-full bg-emerald-500" />
                completed
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block size-2 rounded-full bg-amber-500" />
                blocked
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block size-2 rounded-full bg-purple-500" />
                disagreed
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block size-2 rounded-full bg-red-500" />
                error
              </span>
            </div>
          </div>
          {activity.length > 0 ? (
            <ActivitySparkline buckets={activity} />
          ) : (
            <div className="flex h-16 items-center justify-center text-muted-foreground text-sm">
              {loading ? "Loading..." : "No activity data"}
            </div>
          )}
        </div>

        {/* Last 10 runs */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GitPullRequest className="size-4 text-muted-foreground" />
              <h2 className="font-semibold text-sm">Recent Runs</h2>
            </div>
            <Link
              className="flex items-center gap-1 text-primary text-xs hover:underline"
              href="/pr-runs"
            >
              View all
              <ArrowRight className="size-3" />
            </Link>
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {loading ? (
              <div className="space-y-3 p-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    className="h-10 animate-pulse rounded bg-muted"
                    key={i}
                  />
                ))}
              </div>
            ) : recentRuns.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
                No runs yet
              </div>
            ) : (
              <div className="divide-y divide-border">
                {recentRuns.map((run) => (
                  <Link
                    className="group flex min-h-[52px] items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50"
                    href={`/pr-runs/${encodeURIComponent(run.runId)}`}
                    key={run.runId}
                  >
                    <StatusChip status={run.status} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-sm">
                        {run.prTitle ?? `PR #${run.prNumber}`}
                      </p>
                      <p className="font-mono text-muted-foreground text-xs">
                        {run.owner}/{run.repo} #{run.prNumber}
                      </p>
                    </div>
                    <span className="shrink-0 whitespace-nowrap text-muted-foreground text-xs">
                      {relativeTime(run.updatedAt)}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
