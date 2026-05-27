"use client";

import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Filter,
  Loader2,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";
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
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  prTitle: string | null;
  senderLogin: string | null;
}

type ArchivedFilter = "all" | "archived" | "live";

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
        "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 font-medium text-xs uppercase tracking-wide",
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
  const [archivedFilter, setArchivedFilter] = useState<ArchivedFilter>("all");

  const load = useCallback(
    (
      statuses: RunStatus[],
      repo: string,
      from: string,
      to: string,
      archived: ArchivedFilter,
      p: number
    ) => {
      startTransition(async () => {
        setLoading(true);
        try {
          const params = new URLSearchParams();
          if (statuses.length > 0) {
            params.set("status", statuses.join(","));
          }
          if (repo) {
            params.set("repo", repo);
          }
          if (from) {
            params.set("from", from);
          }
          if (to) {
            params.set("to", to);
          }
          if (archived === "archived") {
            params.set("archived", "true");
          } else if (archived === "live") {
            params.set("archived", "false");
          }
          params.set("limit", String(PAGE_SIZE));
          params.set("offset", String(p * PAGE_SIZE));

          const res = await fetch(`/api/tars/pr-runs?${params.toString()}`);
          if (!res.ok) {
            throw new Error("Failed");
          }
          const data = (await res.json()) as { runs: RunRow[]; total: number };
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
    load(selectedStatuses, repoFilter, dateFrom, dateTo, archivedFilter, page);
  }, [
    load,
    selectedStatuses,
    repoFilter,
    dateFrom,
    dateTo,
    archivedFilter,
    page,
  ]);

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
        className="block space-y-3 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent/50"
        href={`/pr-runs/${encodeURIComponent(run.runId)}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium text-sm">
              {run.prTitle ?? `PR #${run.prNumber}`}
            </p>
            <p className="mt-0.5 font-mono text-muted-foreground text-xs">
              {run.owner}/{run.repo} #{run.prNumber}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <StatusChip status={run.status} />
            {run.archivedAt && (
              <span className="rounded-full border border-zinc-700 bg-zinc-800/50 px-2 py-0.5 font-medium text-[10px] text-zinc-400 uppercase tracking-wide">
                archived
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 text-muted-foreground text-xs">
          {run.findingsCount > 0 && (
            <span>
              {run.findingsCount} finding{run.findingsCount === 1 ? "" : "s"}
            </span>
          )}
          <span className="ml-auto">{relativeTime(run.updatedAt)}</span>
        </div>
      </Link>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 md:py-8">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-bold text-2xl">PR Runs</h1>
            <p className="mt-1 text-muted-foreground text-sm">
              {total.toLocaleString()} total run{total === 1 ? "" : "s"}
            </p>
          </div>
          <Button
            className="min-h-[44px]"
            disabled={isPending}
            onClick={() =>
              load(
                selectedStatuses,
                repoFilter,
                dateFrom,
                dateTo,
                archivedFilter,
                page
              )
            }
            size="sm"
            variant="outline"
          >
            <RefreshCw className={cn("size-4", isPending && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {/* Filters */}
        <div className="space-y-4 rounded-lg border border-border bg-card p-4">
          <div className="mb-2 flex items-center gap-2 text-muted-foreground text-sm">
            <Filter className="size-3.5" />
            Filters
          </div>

          {/* Status chips */}
          <div className="flex flex-wrap gap-1.5">
            {ALL_STATUSES.map((s) => (
              <button
                className={cn(
                  "min-h-[32px] rounded-full border px-2.5 py-1 text-xs transition-colors",
                  selectedStatuses.includes(s)
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-muted hover:bg-accent"
                )}
                key={s}
                onClick={() => toggleStatus(s)}
                type="button"
              >
                {s}
              </button>
            ))}
          </div>

          {/* Archived filter */}
          <div className="flex flex-wrap gap-1.5">
            {(["all", "live", "archived"] as const).map((a) => (
              <button
                className={cn(
                  "min-h-[32px] rounded-full border px-2.5 py-1 text-xs transition-colors",
                  archivedFilter === a
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-muted hover:bg-accent"
                )}
                key={a}
                onClick={() => {
                  setArchivedFilter(a);
                  setPage(0);
                }}
                type="button"
              >
                {a}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-3">
            <Input
              className="w-full sm:w-48"
              onChange={(e) => {
                setRepoFilter(e.target.value);
                setPage(0);
              }}
              placeholder="owner/repo"
              value={repoFilter}
            />
            <Input
              className="w-full sm:w-auto"
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(0);
              }}
              title="From date"
              type="date"
              value={dateFrom}
            />
            <Input
              className="w-full sm:w-auto"
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(0);
              }}
              title="To date"
              type="date"
              value={dateTo}
            />
          </div>
        </div>

        {/* Mobile cards */}
        <div className="space-y-3 md:hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : runs.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                <Filter className="size-5" />
              </div>
              <p className="font-medium text-sm">
                No PR runs match these filters
              </p>
              <p className="text-xs">Try adjusting the status or date range</p>
            </div>
          ) : (
            runs.map((run) => <RunCard key={run.runId} run={run} />)
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden overflow-hidden rounded-lg border border-border bg-card md:block">
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
                          <div className="h-4 animate-pulse rounded bg-muted" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : runs.length === 0 ? (
                  <TableRow>
                    <TableCell
                      className="py-16 text-center text-muted-foreground"
                      colSpan={6}
                    >
                      <div className="flex flex-col items-center gap-2">
                        <Filter className="size-8 opacity-40" />
                        <p className="font-medium text-sm">
                          No PR runs match these filters
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  runs.map((run) => (
                    <TableRow className="group" key={run.runId}>
                      <TableCell>
                        <div className="space-y-0.5">
                          <p className="max-w-[280px] truncate font-medium text-sm">
                            {run.prTitle ?? `PR #${run.prNumber}`}
                          </p>
                          <p className="font-mono text-muted-foreground text-xs">
                            {run.owner}/{run.repo} #{run.prNumber}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusChip status={run.status} />
                          {run.archivedAt && (
                            <span className="rounded-full border border-zinc-700 bg-zinc-800/50 px-1.5 py-0.5 font-medium text-[10px] text-zinc-400 uppercase tracking-wide">
                              archived
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {run.findingsCount > 0 ? (
                          <span>{run.findingsCount}</span>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {run.status === "disagreed" ? (
                          <div className="flex gap-1">
                            <span className="rounded-full border border-purple-500/30 bg-purple-500/10 px-1.5 py-0.5 text-purple-400 text-xs">
                              Codex
                            </span>
                            <span className="rounded-full border border-purple-500/30 bg-purple-500/10 px-1.5 py-0.5 text-purple-400 text-xs">
                              Claude
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">
                            —
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground text-xs">
                        {relativeTime(run.updatedAt)}
                      </TableCell>
                      <TableCell>
                        <Link
                          aria-label={`View run ${run.runId}`}
                          className="inline-flex min-h-[32px] items-center gap-1 text-primary text-xs hover:underline"
                          href={`/pr-runs/${encodeURIComponent(run.runId)}`}
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
          <div className="flex items-center justify-between text-muted-foreground text-sm">
            <span>
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)}{" "}
              of {total}
            </span>
            <div className="flex gap-2">
              <Button
                className="min-h-[44px]"
                disabled={page === 0 || isPending}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                size="sm"
                variant="outline"
              >
                <ChevronLeft className="size-4" />
                Previous
              </Button>
              <Button
                className="min-h-[44px]"
                disabled={page >= totalPages - 1 || isPending}
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                size="sm"
                variant="outline"
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
