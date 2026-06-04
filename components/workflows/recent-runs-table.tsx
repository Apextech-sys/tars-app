"use client";

import { Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { RunFeedRow } from "@/lib/tars/workflows";
import { cn } from "@/lib/utils";
import { ageFromMs, formatDuration, statusMeta } from "./shared";

const STATUS_OPTIONS = [
  "started",
  "pending-approval",
  "disagreed",
  "skipped-no-findings",
  "error",
];

export function RecentRunsTable({
  initialRuns,
  initialTotal,
}: {
  initialRuns: RunFeedRow[];
  initialTotal: number;
}) {
  const [runs, setRuns] = useState<RunFeedRow[]>(initialRuns);
  const [total, setTotal] = useState(initialTotal);
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [repoFilter, setRepoFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);

  const repos = useMemo(() => {
    const set = new Set<string>();
    for (const r of initialRuns) {
      set.add(`${r.owner}/${r.repo}`);
    }
    return [...set].sort();
  }, [initialRuns]);

  const buildQuery = useCallback(
    (nextOffset: number) => {
      const p = new URLSearchParams();
      p.set("limit", "25");
      p.set("offset", String(nextOffset));
      if (statusFilter.size > 0) {
        p.set("status", [...statusFilter].join(","));
      }
      if (repoFilter) {
        p.set("repo", repoFilter);
      }
      return p.toString();
    },
    [statusFilter, repoFilter]
  );

  const reload = useCallback(
    (append: boolean, nextOffset: number) => {
      setLoading(true);
      fetch(`/api/tars/workflows/runs?${buildQuery(nextOffset)}`)
        .then((r) => r.json())
        .then((d) => {
          const rows: RunFeedRow[] = Array.isArray(d.runs) ? d.runs : [];
          setRuns((prev) => (append ? [...prev, ...rows] : rows));
          setTotal(typeof d.total === "number" ? d.total : rows.length);
          setOffset(nextOffset);
        })
        .catch(() => {
          /* keep existing rows on transient failure */
        })
        .finally(() => setLoading(false));
    },
    [buildQuery]
  );

  // Re-query when filters change (skip the very first mount — SSR seeded it).
  const filterKey = `${[...statusFilter].sort().join(",")}|${repoFilter ?? ""}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: callback takes all inputs as arguments and only closes over stable setters/startTransition; adding deps would cause redundant refetch loops
  useEffect(() => {
    if (filterKey === "|") {
      return;
    }
    reload(false, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  const toggleStatus = useCallback((s: string) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(s)) {
        next.delete(s);
      } else {
        next.add(s);
      }
      return next;
    });
  }, []);

  const hasFilter = statusFilter.size > 0 || repoFilter !== null;
  const maxDuration = Math.max(1, ...runs.map((r) => r.durationMs));

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-lg">Recent runs</h2>
        <button
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-muted"
          onClick={() => reload(false, 0)}
          type="button"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />{" "}
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-1.5">
        {STATUS_OPTIONS.map((s) => {
          const meta = statusMeta(s);
          const active = statusFilter.has(s);
          return (
            <button
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                active
                  ? "border-[#00d4a0] bg-[#00d4a0]/10 text-[#00d4a0]"
                  : "hover:bg-muted"
              )}
              key={s}
              onClick={() => toggleStatus(s)}
              type="button"
            >
              {meta.label}
            </button>
          );
        })}
        {repos.length > 1
          ? repos.map((r) => (
              <button
                className={cn(
                  "rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors",
                  repoFilter === r
                    ? "border-[#00d4a0] bg-[#00d4a0]/10 text-[#00d4a0]"
                    : "hover:bg-muted"
                )}
                key={r}
                onClick={() => setRepoFilter(repoFilter === r ? null : r)}
                type="button"
              >
                {r}
              </button>
            ))
          : null}
        {hasFilter ? (
          <button
            className="rounded-full px-2.5 py-1 text-muted-foreground text-xs hover:text-foreground"
            onClick={() => {
              setStatusFilter(new Set());
              setRepoFilter(null);
            }}
            type="button"
          >
            Clear
          </button>
        ) : null}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="hidden grid-cols-[1fr_auto_auto_auto_auto] gap-3 border-b bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground uppercase tracking-wide md:grid">
          <span>Run</span>
          <span className="w-28 text-right">Findings</span>
          <span className="w-24 text-right">Duration</span>
          <span className="w-20 text-right">Age</span>
          <span className="w-32 text-right">Status</span>
        </div>
        {runs.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground text-sm">
            {loading ? "Loading runs…" : "No runs match the current filter."}
          </div>
        ) : (
          <div className="divide-y">
            {runs.map((r) => {
              const meta = statusMeta(r.status);
              return (
                <Link
                  className="grid grid-cols-1 gap-2 px-4 py-3 text-sm transition-colors hover:bg-muted/40 md:grid-cols-[1fr_auto_auto_auto_auto] md:items-center md:gap-3"
                  href={`/workflows/run/${r.runId}`}
                  key={r.runId}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{r.target}</span>
                      {r.prSha ? (
                        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                          {r.prSha.slice(0, 7)}
                        </span>
                      ) : null}
                      {r.isStalled ? (
                        <span className="shrink-0 rounded-full border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-400">
                          stalled
                        </span>
                      ) : null}
                    </div>
                    <div className="truncate text-muted-foreground text-xs">
                      {r.prTitle ?? `${r.owner} · pr-review`}
                    </div>
                  </div>
                  <div className="flex w-28 items-center justify-end gap-1.5 tabular-nums">
                    {r.findingsCount > 0 ? (
                      <>
                        <span className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-muted sm:block">
                          <span
                            className="block h-full rounded-full bg-amber-400/70"
                            style={{
                              width: `${Math.min(100, (r.findingsCount / 10) * 100)}%`,
                            }}
                          />
                        </span>
                        <span className="text-amber-300">
                          {r.findingsCount}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </div>
                  <div className="flex w-24 items-center justify-end gap-1.5">
                    <span className="hidden h-1.5 w-10 overflow-hidden rounded-full bg-muted sm:block">
                      <span
                        className="block h-full rounded-full bg-[#00d4a0]/60"
                        style={{
                          width: `${Math.max(4, (r.durationMs / maxDuration) * 100)}%`,
                        }}
                      />
                    </span>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {formatDuration(r.durationMs)}
                    </span>
                  </div>
                  <span className="w-20 text-right text-muted-foreground text-xs tabular-nums">
                    {ageFromMs(r.ageMs)}
                  </span>
                  <span className="flex w-32 justify-start md:justify-end">
                    <span
                      className={cn(
                        "rounded-full border px-2.5 py-0.5 text-xs",
                        meta.cls
                      )}
                    >
                      {meta.label}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-muted-foreground text-xs">
        <span>
          Showing {runs.length} of {total} runs
        </span>
        {runs.length < total ? (
          <button
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 hover:bg-muted"
            disabled={loading}
            onClick={() => reload(true, offset + 25)}
            type="button"
          >
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : null}{" "}
            Load more
          </button>
        ) : null}
      </div>
    </section>
  );
}
