"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock,
  GitPullRequest,
  Inbox,
  RefreshCw,
  TrendingUp,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function formatMs(ms: number): string {
  if (ms === 0) return "—";
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = s / 60;
  if (m < 60) return `${m.toFixed(1)}m`;
  return `${(m / 60).toFixed(1)}h`;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const STATUS_COLORS: Record<string, string> = {
  started: "bg-blue-500/10 text-blue-400 border border-blue-500/30",
  completed: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30",
  "skipped-no-findings": "bg-zinc-500/10 text-zinc-400 border border-zinc-700",
  "skipped-policy": "bg-zinc-500/10 text-zinc-400 border border-zinc-700",
  "blocked-konverge": "bg-amber-500/10 text-amber-400 border border-amber-500/30",
  disagreed: "bg-purple-500/10 text-purple-400 border border-purple-500/30",
  error: "bg-red-500/10 text-red-400 border border-red-500/30",
};

function StatusChip({ status }: { status: string }) {
  const cls =
    STATUS_COLORS[status] ?? "bg-zinc-500/10 text-zinc-400 border border-zinc-700";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium uppercase tracking-wide whitespace-nowrap shrink-0",
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
    ...buckets.map((b) => b.completed + b.error + b.blocked + b.disagreed + b.started + b.skipped)
  );

  const recent = buckets.slice(-24);

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-0.5 h-16">
        {recent.map((b, i) => {
          const total = b.completed + b.error + b.blocked + b.disagreed + b.started + b.skipped;
          const heightPct = (total / maxVal) * 100;

          // Stacked: completed (green), blocked (amber), disagreed (purple), error (red), started (blue)
          const completedPct = total > 0 ? (b.completed / total) * 100 : 0;
          const blockedPct = total > 0 ? (b.blocked / total) * 100 : 0;
          const disagreedPct = total > 0 ? (b.disagreed / total) * 100 : 0;
          const errorPct = total > 0 ? (b.error / total) * 100 : 0;

          return (
            <div
              key={b.hour}
              className="flex-1 flex flex-col justify-end group relative"
              title={`${new Date(b.hour).getUTCHours()}:00 — ${total} runs`}
            >
              <div
                className="w-full rounded-sm overflow-hidden flex flex-col-reverse transition-all"
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
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-10 bg-popover border border-border rounded px-2 py-1 text-xs whitespace-nowrap shadow-lg">
                {new Date(b.hour).getUTCHours()}:00 — {total}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>24h ago</span>
        <span>now</span>
      </div>
    </div>
  );
}

function WorkerStrip({ workers }: { workers: WorkerData[] }) {
  if (workers.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-3 rounded-lg border border-border bg-card/30">
        <WifiOff className="size-4" />
        <span>No heartbeat data</span>
        <span className="text-xs ml-auto">
          Worker should POST to <code className="font-mono text-xs bg-muted px-1 rounded">/api/tars/worker/heartbeat</code>
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {workers.map((w) => (
        <div
          key={w.workerId}
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-lg border text-sm",
            w.healthStatus === "green"
              ? "border-emerald-500/30 bg-emerald-500/5"
              : w.healthStatus === "amber"
              ? "border-amber-500/30 bg-amber-500/5"
              : "border-red-500/30 bg-red-500/5"
          )}
        >
          {w.healthStatus === "green" ? (
            <Wifi
              className="size-3.5 text-emerald-400"
              aria-label="Worker healthy"
            />
          ) : w.healthStatus === "amber" ? (
            <Wifi
              className="size-3.5 text-amber-400"
              aria-label="Worker degraded"
            />
          ) : (
            <WifiOff
              className="size-3.5 text-red-400"
              aria-label="Worker offline"
            />
          )}
          <div>
            <p className="font-medium text-xs">{w.workerId}</p>
            <p className="text-xs text-muted-foreground">
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

  const errorRateColor =
    !stats
      ? ""
      : stats.errorRate < 5
      ? "text-emerald-400"
      : stats.errorRate < 15
      ? "text-amber-400"
      : "text-red-400";

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-6 md:py-8 space-y-8">
        {/* Hero */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold">
              {getGreeting()}, Shaun
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              {new Date().toLocaleDateString("en-ZA", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={loadAll}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors min-h-[44px] px-3 py-2 rounded-lg border border-border hover:bg-accent"
            aria-label="Refresh dashboard"
          >
            <RefreshCw
              className={cn("size-4", loading && "animate-spin")}
            />
            Refresh
          </button>
        </div>

        {/* KPI Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Runs in flight */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-2">
            <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
              <Zap className="size-3.5" />
              In Flight
            </div>
            <div className="flex items-end gap-2">
              <span
                className={cn(
                  "text-3xl font-bold",
                  !stats
                    ? "text-muted-foreground"
                    : stats.inFlight > 0
                    ? "text-amber-400"
                    : "text-emerald-400"
                )}
              >
                {stats?.inFlight ?? "—"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {stats?.inFlight === 0
                ? "All clear"
                : stats
                ? "Active runs"
                : "Loading..."}
            </p>
            {stats?.inFlight && stats.inFlight > 0 ? (
              <Link
                href="/pr-runs?status=started"
                className="text-xs text-primary hover:underline"
              >
                View active →
              </Link>
            ) : null}
          </div>

          {/* Error rate */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-2">
            <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
              <AlertCircle className="size-3.5" />
              Error Rate (7d)
            </div>
            <div className="flex items-end gap-1">
              <span className={cn("text-3xl font-bold", errorRateColor)}>
                {stats ? `${stats.errorRate}%` : "—"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {stats ? `${stats.total} runs total` : "Loading..."}
            </p>
          </div>

          {/* Mean review time */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-2">
            <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
              <Clock className="size-3.5" />
              Mean Review (7d)
            </div>
            <div>
              <span className="text-3xl font-bold">
                {stats ? formatMs(stats.meanReviewMs) : "—"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">avg duration</p>
          </div>

          {/* Disagreement rate */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-2">
            <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
              <TrendingUp className="size-3.5" />
              Disagreement (7d)
            </div>
            <div>
              <span
                className={cn(
                  "text-3xl font-bold",
                  !stats
                    ? ""
                    : stats.disagreementRate > 20
                    ? "text-red-400"
                    : stats.disagreementRate > 10
                    ? "text-amber-400"
                    : "text-foreground"
                )}
              >
                {stats ? `${stats.disagreementRate}%` : "—"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Codex vs Claude
            </p>
          </div>
        </div>

        {/* Worker heartbeat strip */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Bot className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Worker Status</h2>
          </div>
          <WorkerStrip workers={workers} />
        </div>

        {/* Activity sparkline */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Activity — last 24h</h2>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-full bg-emerald-500 inline-block" />
                completed
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-full bg-amber-500 inline-block" />
                blocked
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-full bg-purple-500 inline-block" />
                disagreed
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-full bg-red-500 inline-block" />
                error
              </span>
            </div>
          </div>
          {activity.length > 0 ? (
            <ActivitySparkline buckets={activity} />
          ) : (
            <div className="h-16 flex items-center justify-center text-muted-foreground text-sm">
              {loading ? "Loading..." : "No activity data"}
            </div>
          )}
        </div>

        {/* Last 10 runs */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GitPullRequest className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Recent Runs</h2>
            </div>
            <Link
              href="/pr-runs"
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              View all
              <ArrowRight className="size-3" />
            </Link>
          </div>

          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {loading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-10 bg-muted animate-pulse rounded"
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
                    key={run.runId}
                    href={`/pr-runs/${encodeURIComponent(run.runId)}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-accent/50 transition-colors group min-h-[52px]"
                  >
                    <StatusChip status={run.status} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {run.prTitle ?? `PR #${run.prNumber}`}
                      </p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {run.owner}/{run.repo} #{run.prNumber}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
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
