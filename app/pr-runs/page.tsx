"use client";

import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  GitPullRequest,
  Loader2,
  RefreshCw,
  Scale,
  ShieldQuestion,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

interface RunRow {
  runId: string;
  owner: string;
  repo: string;
  prNumber: number;
  prSha: string | null;
  status: string;
  findingsCount: number;
  adjudicationAction: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  prTitle: string | null;
  senderLogin: string | null;
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  started: {
    label: "Running",
    cls: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  },
  "pending-approval": {
    label: "Awaiting approval",
    cls: "bg-sky-500/10 text-sky-400 border-sky-500/30",
  },
  approved: {
    label: "Approved",
    cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  },
  rejected: {
    label: "Rejected",
    cls: "bg-rose-500/10 text-rose-400 border-rose-500/30",
  },
  completed: {
    label: "Completed",
    cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  },
  "skipped-no-findings": {
    label: "Clean",
    cls: "bg-zinc-500/10 text-zinc-400 border-zinc-700",
  },
  "skipped-policy": {
    label: "Skipped",
    cls: "bg-zinc-500/10 text-zinc-400 border-zinc-700",
  },
  "blocked-konverge": {
    label: "Blocked",
    cls: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  },
  disagreed: {
    label: "Disagreed",
    cls: "bg-purple-500/10 text-purple-400 border-purple-500/30",
  },
  error: {
    label: "Error",
    cls: "bg-rose-500/10 text-rose-400 border-rose-500/30",
  },
};

function statusMeta(s: string) {
  return (
    STATUS_META[s] ?? {
      label: s,
      cls: "bg-zinc-500/10 text-zinc-400 border-zinc-700",
    }
  );
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 60) {
    return `${s}s ago`;
  }
  const m = Math.round(s / 60);
  if (m < 60) {
    return `${m}m ago`;
  }
  const h = Math.round(m / 60);
  if (h < 24) {
    return `${h}h ago`;
  }
  return `${Math.round(h / 24)}d ago`;
}

interface Tile {
  key: string;
  label: string;
  value: number;
  icon: typeof GitPullRequest;
  tone: "neutral" | "good" | "warn" | "bad";
  filter?: string[];
}
const TONE: Record<string, string> = {
  neutral: "text-foreground",
  good: "text-[#00d4a0]",
  warn: "text-amber-400",
  bad: "text-red-400",
};

function RunsTable({
  loading,
  filtered,
  maxFindings,
}: {
  loading: boolean;
  filtered: RunRow[];
  maxFindings: number;
}): ReactNode {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground text-sm">
        <Loader2 className="size-4 animate-spin" /> Loading reviews…
      </div>
    );
  }
  if (filtered.length === 0) {
    return (
      <div className="py-16 text-center text-muted-foreground text-sm">
        No reviews match the current filter.
      </div>
    );
  }
  return (
    <div className="divide-y">
      {filtered.map((r) => {
        const meta = statusMeta(r.status);
        return (
          <Link
            className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/40"
            href={`/pr-runs/${r.runId}`}
            key={r.runId}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">
                  {r.prTitle ?? `${r.repo} #${r.prNumber}`}
                </span>
                {r.prSha ? (
                  <span className="shrink-0 font-mono text-muted-foreground text-xs">
                    {r.prSha.slice(0, 7)}
                  </span>
                ) : null}
              </div>
              <div className="truncate text-muted-foreground text-xs">
                {r.repo} #{r.prNumber} · {r.owner}
                {r.senderLogin ? ` · @${r.senderLogin}` : ""} ·{" "}
                {relativeTime(r.updatedAt)}
              </div>
            </div>
            {r.findingsCount > 0 ? (
              <div className="hidden w-24 shrink-0 sm:block">
                <div className="flex items-center justify-end gap-1.5">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-amber-400/70"
                      style={{
                        width: `${(r.findingsCount / maxFindings) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {r.findingsCount}
                  </span>
                </div>
              </div>
            ) : (
              <span className="hidden w-24 shrink-0 text-right text-muted-foreground text-xs sm:block">
                no findings
              </span>
            )}
            <span
              className={cn(
                "shrink-0 rounded-full border px-2.5 py-0.5 text-xs",
                meta.cls
              )}
            >
              {meta.label}
            </span>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        );
      })}
    </div>
  );
}

export default function PrRunsPage() {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [repoFilter, setRepoFilter] = useState<string | null>(null);

  const load = useCallback(() => {
    setRefreshing(true);
    fetch("/api/tars/pr-runs?limit=100&archived=false")
      .then((r) => r.json())
      .then((d) => setRuns(Array.isArray(d.runs) ? d.runs : []))
      .catch(() => setRuns([]))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const c = {
      pending: 0,
      disagreed: 0,
      clean: 0,
      running: 0,
      error: 0,
      findings: 0,
    };
    const statusKey: Record<string, keyof typeof c> = {
      "pending-approval": "pending",
      disagreed: "disagreed",
      "skipped-no-findings": "clean",
      started: "running",
      error: "error",
    };
    for (const r of runs) {
      const key = statusKey[r.status];
      if (key) {
        c[key] += 1;
      }
      c.findings += r.findingsCount || 0;
    }
    return c;
  }, [runs]);

  const tiles: Tile[] = [
    {
      key: "pending",
      label: "Awaiting your approval",
      value: counts.pending,
      icon: ShieldQuestion,
      tone: counts.pending > 0 ? "warn" : "neutral",
      filter: ["pending-approval"],
    },
    {
      key: "disagreed",
      label: "Reviewer disagreements",
      value: counts.disagreed,
      icon: Scale,
      tone: counts.disagreed > 0 ? "bad" : "neutral",
      filter: ["disagreed"],
    },
    {
      key: "clean",
      label: "Clean (no findings)",
      value: counts.clean,
      icon: CheckCircle2,
      tone: "good",
      filter: ["skipped-no-findings"],
    },
    {
      key: "findings",
      label: "Findings raised",
      value: counts.findings,
      icon: AlertTriangle,
      tone: counts.findings > 0 ? "warn" : "neutral",
    },
    {
      key: "running",
      label: "In flight / errored",
      value: counts.running + counts.error,
      icon: Loader2,
      tone: counts.error > 0 ? "bad" : "neutral",
      filter: ["started", "error"],
    },
    {
      key: "total",
      label: "Total reviews",
      value: runs.length,
      icon: GitPullRequest,
      tone: "neutral",
    },
  ];

  const repos = useMemo(() => {
    const set = new Set<string>();
    for (const r of runs) {
      set.add(`${r.owner}/${r.repo}`);
    }
    return [...set].sort();
  }, [runs]);

  const filtered = useMemo(() => {
    return runs.filter((r) => {
      if (statusFilter.size > 0 && !statusFilter.has(r.status)) {
        return false;
      }
      if (repoFilter && `${r.owner}/${r.repo}` !== repoFilter) {
        return false;
      }
      return true;
    });
  }, [runs, statusFilter, repoFilter]);

  const toggleStatus = useCallback((statuses: string[]) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      const allOn = statuses.every((s) => next.has(s));
      if (allOn) {
        for (const s of statuses) {
          next.delete(s);
        }
      } else {
        for (const s of statuses) {
          next.add(s);
        }
      }
      return next;
    });
  }, []);

  const needsAttention = counts.pending + counts.disagreed + counts.error;
  const maxFindings = Math.max(1, ...runs.map((r) => r.findingsCount || 0));

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-semibold text-xl">
            <GitPullRequest className="size-5 text-[#00d4a0]" /> PR Reviews
          </h1>
          <p className="text-muted-foreground text-sm">
            Every dual-AI (Claude + Codex) review TARS has run · click a metric
            to filter
          </p>
        </div>
        <button
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-muted"
          onClick={load}
          type="button"
        >
          <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />{" "}
          Refresh
        </button>
      </div>

      {/* Hero tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => {
          const active = t.filter?.every((s) => statusFilter.has(s)) ?? false;
          return (
            <button
              className={cn(
                "rounded-xl border bg-card p-4 text-left transition-colors",
                t.filter ? "hover:border-[#00d4a0]/50" : "cursor-default",
                active && "border-[#00d4a0] ring-1 ring-[#00d4a0]/40"
              )}
              disabled={!t.filter}
              key={t.key}
              onClick={() => t.filter && toggleStatus(t.filter)}
              type="button"
            >
              <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
                <t.icon className="size-4" /> {t.label}
              </div>
              <div
                className={cn(
                  "mt-1 font-semibold text-2xl tabular-nums",
                  TONE[t.tone]
                )}
              >
                {t.value}
              </div>
            </button>
          );
        })}
      </div>

      {/* Needs-attention banner */}
      {needsAttention > 0 ? (
        <button
          className="flex w-full items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-300 text-sm hover:bg-amber-500/15"
          onClick={() =>
            setStatusFilter(new Set(["pending-approval", "disagreed", "error"]))
          }
          type="button"
        >
          <AlertTriangle className="size-4" />
          <span className="font-medium">
            {needsAttention} review{needsAttention === 1 ? "" : "s"} need you
          </span>
          <span className="text-amber-300/70">
            · {counts.pending} to approve · {counts.disagreed} disagreements
            {counts.error > 0 ? ` · ${counts.error} errored` : ""}
          </span>
          <ArrowRight className="ml-auto size-4" />
        </button>
      ) : null}

      {/* Repo filter */}
      {repos.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              repoFilter === null
                ? "border-[#00d4a0] bg-[#00d4a0]/10 text-[#00d4a0]"
                : "hover:bg-muted"
            )}
            onClick={() => setRepoFilter(null)}
            type="button"
          >
            All repos
          </button>
          {repos.map((r) => (
            <button
              className={cn(
                "rounded-full border px-3 py-1 font-mono text-xs",
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
          ))}
          {(statusFilter.size > 0 || repoFilter) && (
            <button
              className="rounded-full px-3 py-1 text-muted-foreground text-xs hover:text-foreground"
              onClick={() => {
                setStatusFilter(new Set());
                setRepoFilter(null);
              }}
              type="button"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : null}

      {/* Runs table */}
      <div className="overflow-hidden rounded-xl border bg-card">
        <RunsTable
          filtered={filtered}
          loading={loading}
          maxFindings={maxFindings}
        />
      </div>
      <p className="text-muted-foreground text-xs">
        Showing {filtered.length} of {runs.length} live reviews. Click a row for
        the full pipeline, the Claude-vs-Codex findings, and the approval gate.
      </p>
    </div>
  );
}
