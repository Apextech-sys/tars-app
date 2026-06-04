"use client";

import { ArrowRight, GitPullRequest, TrendingUp } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { ActivityBucket, FeedRow } from "./types";
import { relativeTimeFromIso } from "./types";

const STATUS_COLORS: Record<string, string> = {
  start: "bg-blue-500/10 text-blue-400 border border-blue-500/30",
  started: "bg-blue-500/10 text-blue-400 border border-blue-500/30",
  ok: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30",
  completed: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30",
  info: "bg-zinc-500/10 text-zinc-400 border border-zinc-700",
  skip: "bg-zinc-500/10 text-zinc-400 border border-zinc-700",
  "skipped-no-findings": "bg-zinc-500/10 text-zinc-400 border border-zinc-700",
  disagreed: "bg-purple-500/10 text-purple-400 border border-purple-500/30",
  "pending-approval": "bg-sky-500/10 text-sky-400 border border-sky-500/30",
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

interface ActivityWindow {
  hours: number;
  label: string;
}
const WINDOWS: ActivityWindow[] = [
  { hours: 24, label: "24h" },
  { hours: 168, label: "7d" },
];

export function ActivitySparkline({
  buckets,
  hours,
  onWindowChange,
  loading,
}: {
  buckets: ActivityBucket[];
  hours: number;
  onWindowChange: (hours: number) => void;
  loading: boolean;
}) {
  const maxVal = Math.max(
    1,
    ...buckets.map(
      (b) =>
        b.completed + b.error + b.blocked + b.disagreed + b.started + b.skipped
    )
  );

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="size-4 text-muted-foreground" />
          <h2 className="font-semibold text-sm">PR activity</h2>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5 text-muted-foreground text-xs">
            <span className="flex items-center gap-1">
              <span className="inline-block size-2 rounded-full bg-emerald-500" />
              done
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
          <div className="flex gap-1">
            {WINDOWS.map((w) => (
              <button
                className={cn(
                  "rounded-md border px-2 py-0.5 text-xs transition-colors",
                  hours === w.hours
                    ? "border-[#00d4a0]/40 bg-[#00d4a0]/10 text-[#00d4a0]"
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
                key={w.hours}
                onClick={() => onWindowChange(w.hours)}
                type="button"
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {buckets.length > 0 ? (
        <div className="flex h-16 items-end gap-0.5">
          {buckets.map((b) => {
            const total =
              b.completed +
              b.error +
              b.blocked +
              b.disagreed +
              b.started +
              b.skipped;
            const heightPct = (total / maxVal) * 100;
            const seg = (n: number) => (total > 0 ? (n / total) * 100 : 0);
            return (
              <div
                className="group relative flex flex-1 flex-col justify-end"
                key={b.hour}
                title={`${new Date(b.hour).getUTCHours()}:00 — ${total} runs`}
              >
                <div
                  className="flex w-full flex-col-reverse overflow-hidden rounded-sm"
                  style={{
                    height: `${Math.max(heightPct, total > 0 ? 8 : 2)}%`,
                  }}
                >
                  <div
                    className="bg-emerald-500/70"
                    style={{ height: `${seg(b.completed + b.skipped)}%` }}
                  />
                  <div
                    className="bg-amber-500/70"
                    style={{ height: `${seg(b.blocked)}%` }}
                  />
                  <div
                    className="bg-purple-500/70"
                    style={{ height: `${seg(b.disagreed)}%` }}
                  />
                  <div
                    className="bg-red-500/70"
                    style={{ height: `${seg(b.error)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex h-16 items-center justify-center text-muted-foreground text-sm">
          {loading ? "Loading…" : "No activity"}
        </div>
      )}
    </section>
  );
}

function feedHref(row: FeedRow): string {
  if (row.runId) {
    return `/pr-runs/${encodeURIComponent(row.runId)}`;
  }
  return "/audit";
}

function feedLabel(row: FeedRow): string {
  if (row.prTitle) {
    return row.prTitle;
  }
  if (row.owner && row.repo && row.prNumber) {
    return `${row.owner}/${row.repo} #${row.prNumber}`;
  }
  return `${row.workflow} · ${row.step}`;
}

export function RecentActivityFeed({
  rows,
  loading,
}: {
  rows: FeedRow[];
  loading: boolean;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-semibold text-sm">
          <GitPullRequest className="size-4 text-muted-foreground" />
          Recent activity
          <span className="font-normal text-muted-foreground">
            · across every workflow
          </span>
        </h2>
        <Link
          className="flex items-center gap-1 text-[#00d4a0] text-xs hover:underline"
          href="/audit"
        >
          View all
          <ArrowRight className="size-3" />
        </Link>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {loading && rows.length === 0 ? (
          <div className="space-y-3 p-4">
            {["a", "b", "c", "d"].map((k) => (
              <div className="h-10 animate-pulse rounded bg-muted" key={k} />
            ))}
          </div>
        ) : null}
        {!loading && rows.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            No activity yet
          </div>
        ) : null}
        {rows.length > 0 ? (
          <div className="divide-y divide-border">
            {rows.map((row) => (
              <Link
                className="group flex min-h-[48px] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent/50"
                href={feedHref(row)}
                key={row.id}
              >
                <StatusChip status={row.status} />
                <span className="shrink-0 font-mono text-muted-foreground text-xs">
                  {row.workflow}/{row.step}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {feedLabel(row)}
                </span>
                <span className="shrink-0 whitespace-nowrap text-muted-foreground text-xs tabular-nums">
                  {relativeTimeFromIso(row.createdAt)}
                </span>
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
