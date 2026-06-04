"use client";

import { Activity, GitBranch, Scale, TrendingUp } from "lucide-react";
import { useState } from "react";
import type { ThroughputStats } from "@/lib/tars/workflows";
import { cn } from "@/lib/utils";
import { formatDuration } from "./shared";

function MetricTile({
  icon: Icon,
  label,
  value,
  tone,
  children,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  tone?: "good" | "warn" | "bad";
  children?: React.ReactNode;
}) {
  let toneCls = "text-foreground";
  if (tone === "good") {
    toneCls = "text-[#00d4a0]";
  } else if (tone === "warn") {
    toneCls = "text-amber-400";
  } else if (tone === "bad") {
    toneCls = "text-red-400";
  }
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
        <Icon className="size-4" /> {label}
      </div>
      <div className={cn("mt-1 font-semibold text-2xl tabular-nums", toneCls)}>
        {value}
      </div>
      {children}
    </div>
  );
}

export function ThroughputStrip({ initial }: { initial: ThroughputStats }) {
  const [data, setData] = useState<ThroughputStats>(initial);
  const [windowDays, setWindowDays] = useState(initial.windowDays);
  const [loading, setLoading] = useState(false);

  const setWindow = (days: number) => {
    if (days === windowDays) {
      return;
    }
    setWindowDays(days);
    setLoading(true);
    fetch(`/api/tars/workflows/fleet?window=${days === 30 ? "30d" : "7d"}`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.throughput) {
          setData(d.throughput as ThroughputStats);
        }
      })
      .catch(() => {
        /* keep prior window */
      })
      .finally(() => setLoading(false));
  };

  const maxDay = Math.max(1, ...data.perDay.map((d) => d.count));
  const maxRepo = Math.max(1, ...data.perRepo.map((r) => r.count));
  let successTone: "good" | "warn" | "bad" = "good";
  if (data.successRate < 60) {
    successTone = "bad";
  } else if (data.successRate < 90) {
    successTone = "warn";
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-lg">Throughput &amp; reliability</h2>
        <div className="flex items-center gap-1 rounded-lg border p-0.5 text-xs">
          {[7, 30].map((d) => (
            <button
              className={cn(
                "rounded-md px-2.5 py-1 transition-colors",
                windowDays === d
                  ? "bg-[#00d4a0]/15 text-[#00d4a0]"
                  : "text-muted-foreground hover:text-foreground"
              )}
              key={d}
              onClick={() => setWindow(d)}
              type="button"
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      <div
        className={cn(
          "grid gap-3 sm:grid-cols-2 lg:grid-cols-4",
          loading && "opacity-60"
        )}
      >
        <MetricTile
          icon={TrendingUp}
          label={`Runs · ${windowDays}d`}
          value={String(data.total)}
        >
          <div className="mt-2 flex h-10 items-end gap-px">
            {data.perDay.map((d) => (
              <div
                className={cn(
                  "flex-1 rounded-t",
                  d.count > 0 ? "bg-[#00d4a0]/70" : "bg-muted"
                )}
                key={d.date}
                style={{
                  height: `${d.count > 0 ? Math.max(8, (d.count / maxDay) * 100) : 4}%`,
                }}
                title={`${d.date}: ${d.count}`}
              />
            ))}
          </div>
        </MetricTile>

        <MetricTile
          icon={Activity}
          label="Success rate"
          tone={successTone}
          value={`${data.successRate}%`}
        >
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-[#00d4a0]/70"
              style={{ width: `${data.successRate}%` }}
            />
          </div>
          <div className="mt-1 text-muted-foreground text-xs">
            {data.errorRate}% errored · {data.disagreementRate}% disagreed
          </div>
        </MetricTile>

        <MetricTile
          icon={Scale}
          label="Review latency"
          value={formatDuration(data.meanDurationMs)}
        >
          <div className="mt-2 text-muted-foreground text-xs">
            p95 {formatDuration(data.p95DurationMs)}
          </div>
        </MetricTile>

        <MetricTile
          icon={GitBranch}
          label="Top repo"
          value={data.perRepo[0] ? String(data.perRepo[0].count) : "0"}
        >
          <div className="mt-1 truncate font-mono text-muted-foreground text-xs">
            {data.perRepo[0]?.repo ?? "—"}
          </div>
        </MetricTile>
      </div>

      {data.perRepo.length > 0 ? (
        <details className="rounded-xl border bg-card p-4">
          <summary className="cursor-pointer text-muted-foreground text-sm hover:text-foreground">
            Per-repo breakdown
          </summary>
          <div className="mt-3 space-y-2">
            {data.perRepo.map((r) => (
              <div className="flex items-center gap-3 text-xs" key={r.repo}>
                <span className="w-56 shrink-0 truncate font-mono">
                  {r.repo}
                </span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-[#00d4a0]/70"
                    style={{ width: `${(r.count / maxRepo) * 100}%` }}
                  />
                </span>
                <span className="w-8 text-right tabular-nums">{r.count}</span>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}
