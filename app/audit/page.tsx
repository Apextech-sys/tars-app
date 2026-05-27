"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Download,
  RefreshCw,
  Search,
} from "lucide-react";
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
import {
  type AuditFilters,
  type AuditRow,
  fetchAuditDistinctRepos,
  fetchAuditDistinctSteps,
  fetchAuditLogs,
} from "./actions";

const PAGE_SIZE = 50;

function statusVariant(
  status: string,
): "default" | "success" | "destructive" | "secondary" | "warning" {
  if (status === "ok" || status === "done" || status === "success")
    return "success";
  if (status === "error" || status === "failed") return "destructive";
  if (status === "skipped") return "secondary";
  if (status === "warn" || status === "warning") return "warning";
  return "default";
}

function JsonExpander({ data }: { data: unknown }) {
  return (
    <pre className="text-xs bg-muted rounded-md p-3 overflow-auto max-h-72 whitespace-pre-wrap break-all">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

type SortDir = "asc" | "desc";
type SortCol = "id" | "runId" | "step" | "status" | "repo" | "createdAt";

export default function AuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState<AuditFilters>({});
  const [runIdSearch, setRunIdSearch] = useState("");
  const [availableSteps, setAvailableSteps] = useState<string[]>([]);
  const [availableRepos, setAvailableRepos] = useState<string[]>([]);
  const [selectedSteps, setSelectedSteps] = useState<string[]>([]);
  const [selectedRepos, setSelectedRepos] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [sortCol, setSortCol] = useState<SortCol>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    Promise.all([fetchAuditDistinctSteps(), fetchAuditDistinctRepos()]).then(
      ([steps, repos]) => {
        setAvailableSteps(steps);
        setAvailableRepos(repos);
      },
    );
  }, []);

  const load = useCallback(
    (f: AuditFilters, p: number) => {
      startTransition(async () => {
        setLoading(true);
        const result = await fetchAuditLogs({
          ...f,
          limit: PAGE_SIZE,
          offset: p * PAGE_SIZE,
        });
        setRows(result.rows);
        setTotal(result.total);
        setLoading(false);
      });
    },
    [],
  );

  const applyFilters = useCallback(() => {
    const f: AuditFilters = {
      runId: runIdSearch || undefined,
      steps: selectedSteps.length > 0 ? selectedSteps : undefined,
      repos: selectedRepos.length > 0 ? selectedRepos : undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    };
    setFilters(f);
    setPage(0);
    load(f, 0);
  }, [runIdSearch, selectedSteps, selectedRepos, dateFrom, dateTo, load]);

  useEffect(() => {
    load(filters, page);
  }, [load, filters, page]);

  const handleSort = (col: SortCol) => {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  const sortedRows = [...rows].sort((a, b) => {
    const av = a[sortCol as keyof AuditRow];
    const bv = b[sortCol as keyof AuditRow];
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    const cmp = String(av).localeCompare(String(bv), undefined, {
      numeric: true,
    });
    return sortDir === "asc" ? cmp : -cmp;
  });

  const SortIcon = ({ col }: { col: SortCol }) => {
    if (sortCol !== col) return <ChevronsUpDown className="size-3 ml-1" />;
    return sortDir === "asc" ? (
      <ChevronUp className="size-3 ml-1" />
    ) : (
      <ChevronDown className="size-3 ml-1" />
    );
  };

  const exportCsv = () => {
    const params = new URLSearchParams();
    if (filters.runId) params.set("runId", filters.runId);
    for (const s of filters.steps ?? []) params.append("step", s);
    for (const r of filters.repos ?? []) params.append("repo", r);
    if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
    if (filters.dateTo) params.set("dateTo", filters.dateTo);
    window.location.href = `/api/audit/export?${params.toString()}`;
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Audit Log</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {total.toLocaleString()} total records
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => load(filters, page)}
              disabled={isPending}
            >
              <RefreshCw
                className={cn("size-4", isPending && "animate-spin")}
              />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="size-4" />
              Export CSV
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="rounded-lg border bg-card p-4 space-y-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                placeholder="Search run_id..."
                className="pl-8"
                value={runIdSearch}
                onChange={(e) => setRunIdSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && applyFilters()}
              />
            </div>
            <Input
              type="date"
              className="w-auto"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              title="From date"
            />
            <Input
              type="date"
              className="w-auto"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              title="To date"
            />
            <Button onClick={applyFilters} size="sm">
              Apply
            </Button>
          </div>

          {availableSteps.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground font-medium">Steps</p>
              <div className="flex flex-wrap gap-1.5">
                {availableSteps.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() =>
                      setSelectedSteps((prev) =>
                        prev.includes(s)
                          ? prev.filter((x) => x !== s)
                          : [...prev, s],
                      )
                    }
                    className={cn(
                      "px-2 py-0.5 rounded-full text-xs border transition-colors",
                      selectedSteps.includes(s)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted border-border hover:bg-accent",
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {availableRepos.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground font-medium">Repos</p>
              <div className="flex flex-wrap gap-1.5">
                {availableRepos.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() =>
                      setSelectedRepos((prev) =>
                        prev.includes(r)
                          ? prev.filter((x) => x !== r)
                          : [...prev, r],
                      )
                    }
                    className={cn(
                      "px-2 py-0.5 rounded-full text-xs border transition-colors",
                      selectedRepos.includes(r)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted border-border hover:bg-accent",
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Table */}
        <div className="rounded-lg border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead
                  className="w-12 cursor-pointer select-none"
                  onClick={() => handleSort("id")}
                >
                  <span className="flex items-center">
                    ID
                    <SortIcon col="id" />
                  </span>
                </TableHead>
                <TableHead
                  className="cursor-pointer select-none"
                  onClick={() => handleSort("runId")}
                >
                  <span className="flex items-center">
                    Run ID
                    <SortIcon col="runId" />
                  </span>
                </TableHead>
                <TableHead
                  className="cursor-pointer select-none"
                  onClick={() => handleSort("step")}
                >
                  <span className="flex items-center">
                    Step
                    <SortIcon col="step" />
                  </span>
                </TableHead>
                <TableHead
                  className="cursor-pointer select-none"
                  onClick={() => handleSort("status")}
                >
                  <span className="flex items-center">
                    Status
                    <SortIcon col="status" />
                  </span>
                </TableHead>
                <TableHead
                  className="cursor-pointer select-none"
                  onClick={() => handleSort("repo")}
                >
                  <span className="flex items-center">
                    Repo
                    <SortIcon col="repo" />
                  </span>
                </TableHead>
                <TableHead>PR</TableHead>
                <TableHead
                  className="cursor-pointer select-none"
                  onClick={() => handleSort("createdAt")}
                >
                  <span className="flex items-center">
                    Time
                    <SortIcon col="createdAt" />
                  </span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12">
                    <RefreshCw className="size-4 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : sortedRows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center py-12 text-muted-foreground text-sm"
                  >
                    No records match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                sortedRows.map((row) => (
                  <>
                    <TableRow
                      key={row.id}
                      className="cursor-pointer"
                      onClick={() =>
                        setExpandedRow(expandedRow === row.id ? null : row.id)
                      }
                    >
                      <TableCell className="text-muted-foreground text-xs">
                        {row.id}
                      </TableCell>
                      <TableCell className="font-mono text-xs max-w-[180px] truncate">
                        {row.runId}
                      </TableCell>
                      <TableCell className="text-xs">{row.step}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(row.status)}>
                          {row.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.repo ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.prNumber ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(row.createdAt).toLocaleString()}
                      </TableCell>
                    </TableRow>
                    {expandedRow === row.id && (
                      <TableRow key={`${row.id}-expanded`}>
                        <TableCell colSpan={7} className="bg-muted/30 p-0">
                          <div className="p-4 space-y-2">
                            {row.message && (
                              <p className="text-sm text-foreground">
                                {row.message}
                              </p>
                            )}
                            <p className="text-xs text-muted-foreground font-medium">
                              Payload
                            </p>
                            <JsonExpander data={row.data} />
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Showing {page * PAGE_SIZE + 1}–
              {Math.min((page + 1) * PAGE_SIZE, total)} of {total}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setPage((p) => Math.min(totalPages - 1, p + 1))
                }
                disabled={page >= totalPages - 1}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
