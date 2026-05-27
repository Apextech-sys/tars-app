"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Filter,
  Loader2,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;

const ALL_STATUSES = [
  "started",
  "completed",
  "skipped-no-findings",
  "skipped-policy",
  "blocked-konverge",
  "disagreed",
  "error",
] as const;

type RunStatus = (typeof ALL_STATUSES)[number];

interface RunRow {
  runId: string;
  owner: string;
  repo: string;
  prNumber: number;
  prSha: string | null;
  status: string;
  findingsCount: number;
  adjudicationAction: string | null;
  createdAt: string;
  updatedAt: string;
  prTitle: string | null;
  senderLogin: string | null;
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
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium uppercase tracking-wide whitespace-nowrap",
        cls
      )}
    >
      {status}
    </span>
  );
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

export default function PrRunsListPage() {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  // Filters
  const [selectedStatuses, setSelectedStatuses] = useState<RunStatus[]>([]);
  const [repoFilter, setRepoFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const load = useCallback(
    (
      statuses: RunStatus[],
      repo: string,
      from: string,
      to: string,
      p: number
    ) => {
      startTransition(async () => {
        setLoading(true);
        try {
          const params = new URLSearchParams();
          if (statuses.length > 0) params.set("status", statuses.join(","));
          if (repo) params.set("repo", repo);
          if (from) params.set("from", from);
          if (to) params.set("to", to);
          params.set("limit", String(PAGE_SIZE));
          params.set("offset", String(p * PAGE_SIZE));

          const res = await fetch(`/api/tars/pr-runs?${params.toString()}`);
          if (!res.ok) throw new Error("Failed");
          const data = await res.json() as { runs: RunRow[]; total: number };
          setRuns(data.runs);
          setTotal(data.total);
        } finally {
          setLoading(false);
        }
      });
    },
    []
  );

  useEffect(() => {
    load(selectedStatuses, repoFilter, dateFrom, dateTo, page);
  }, [load, selectedStatuses, repoFilter, dateFrom, dateTo, page]);

  const toggleStatus = (s: RunStatus) => {
    setSelectedStatuses((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
    setPage(0);
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  // Card layout for mobile
  function RunCard({ run }: { run: RunRow }) {
    return (
      <Link
        href={`/pr-runs/${encodeURIComponent(run.runId)}`}
        className="block rounded-lg border border-border bg-card p-4 space-y-3 hover:bg-accent/50 transition-colors"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium text-sm truncate">
              {run.prTitle ?? `PR #${run.prNumber}`}
            </p>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">
              {run.owner}/{run.repo} #{run.prNumber}
            </p>
          </div>
          <StatusChip status={run.status} />
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {run.findingsCount > 0 && (
            <span>
              {run.findingsCount} finding{run.findingsCount !== 1 ? "s" : ""}
            </span>
          )}
          <span className="ml-auto">{relativeTime(run.updatedAt)}</span>
        </div>
      </Link>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-6 md:py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">PR Runs</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {total.toLocaleString()} total run{total !== 1 ? "s" : ""}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="min-h-[44px]"
            onClick={() =>
              load(selectedStatuses, repoFilter, dateFrom, dateTo, page)
            }
            disabled={isPending}
          >
            <RefreshCw
              className={cn("size-4", isPending && "animate-spin")}
            />
            Refresh
          </Button>
        </div>

        {/* Filters */}
        <div className="rounded-lg border border-border bg-card p-4 space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <Filter className="size-3.5" />
            Filters
          </div>

          {/* Status chips */}
          <div className="flex flex-wrap gap-1.5">
            {ALL_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => toggleStatus(s)}
                className={cn(
                  "px-2.5 py-1 rounded-full text-xs border transition-colors min-h-[32px]",
                  selectedStatuses.includes(s)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted border-border hover:bg-accent"
                )}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-3">
            <Input
              placeholder="owner/repo"
              className="w-full sm:w-48"
              value={repoFilter}
              onChange={(e) => {
                setRepoFilter(e.target.value);
                setPage(0);
              }}
            />
            <Input
              type="date"
              className="w-full sm:w-auto"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(0);
              }}
              title="From date"
            />
            <Input
              type="date"
              className="w-full sm:w-auto"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(0);
              }}
              title="To date"
            />
          </div>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : runs.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
              <div className="size-12 rounded-full bg-muted flex items-center justify-center">
                <Filter className="size-5" />
              </div>
              <p className="text-sm font-medium">No PR runs match these filters</p>
              <p className="text-xs">Try adjusting the status or date range</p>
            </div>
          ) : (
            runs.map((run) => <RunCard key={run.runId} run={run} />)
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block rounded-lg border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PR</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Findings</TableHead>
                  <TableHead>Reviewer</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  // Skeleton rows
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={`skeleton-${i}`}>
                      {Array.from({ length: 6 }).map((__, j) => (
                        <TableCell key={j}>
                          <div className="h-4 bg-muted animate-pulse rounded" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : runs.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center py-16 text-muted-foreground"
                    >
                      <div className="flex flex-col items-center gap-2">
                        <Filter className="size-8 opacity-40" />
                        <p className="text-sm font-medium">
                          No PR runs match these filters
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  runs.map((run) => (
                    <TableRow key={run.runId} className="group">
                      <TableCell>
                        <div className="space-y-0.5">
                          <p className="font-medium text-sm max-w-[280px] truncate">
                            {run.prTitle ?? `PR #${run.prNumber}`}
                          </p>
                          <p className="text-xs text-muted-foreground font-mono">
                            {run.owner}/{run.repo} #{run.prNumber}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusChip status={run.status} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {run.findingsCount > 0 ? (
                          <span>{run.findingsCount}</span>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {run.status === "disagreed" ? (
                          <div className="flex gap-1">
                            <span className="text-xs bg-purple-500/10 text-purple-400 border border-purple-500/30 px-1.5 py-0.5 rounded-full">
                              Codex
                            </span>
                            <span className="text-xs bg-purple-500/10 text-purple-400 border border-purple-500/30 px-1.5 py-0.5 rounded-full">
                              Claude
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {relativeTime(run.updatedAt)}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/pr-runs/${encodeURIComponent(run.runId)}`}
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline min-h-[32px]"
                          aria-label={`View run ${run.runId}`}
                        >
                          View
                          <ExternalLink className="size-3" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)}{" "}
              of {total}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="min-h-[44px]"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0 || isPending}
              >
                <ChevronLeft className="size-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="min-h-[44px]"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1 || isPending}
              >
                Next
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
