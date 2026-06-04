"use client";

import { ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  type AuditFailure,
  type AuditFilters,
  type AuditRunGroup,
  type AuditSummary,
  fetchAuditDistinctRepos,
  fetchAuditDistinctSteps,
  fetchAuditFailures,
  fetchAuditRuns,
  fetchAuditSummary,
} from "./actions";
import { ActivityBreakdowns } from "./components/activity-breakdowns";
import { FailuresSpotlight } from "./components/failures-spotlight";
import { FilterBar, type FilterState } from "./components/filter-bar";
import { HeroBand, StatusBanner } from "./components/hero-band";
import { RunCard } from "./components/run-card";

const RUNS_PAGE_SIZE = 25;

const EMPTY_FILTERS: FilterState = {
  search: "",
  repos: [],
  steps: [],
  statuses: [],
  dateFrom: "",
  dateTo: "",
};

function toAuditFilters(f: FilterState): AuditFilters {
  return {
    runId: f.search || undefined,
    repos: f.repos.length > 0 ? f.repos : undefined,
    steps: f.steps.length > 0 ? f.steps : undefined,
    statuses: f.statuses.length > 0 ? f.statuses : undefined,
    dateFrom: f.dateFrom || undefined,
    dateTo: f.dateTo || undefined,
  };
}

function toggle(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export default function AuditPage() {
  const [draft, setDraft] = useState<FilterState>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<FilterState>(EMPTY_FILTERS);
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [runs, setRuns] = useState<AuditRunGroup[]>([]);
  const [runsTotal, setRunsTotal] = useState(0);
  const [failures, setFailures] = useState<AuditFailure[]>([]);
  const [availableRepos, setAvailableRepos] = useState<string[]>([]);
  const [availableSteps, setAvailableSteps] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    Promise.all([fetchAuditDistinctSteps(), fetchAuditDistinctRepos()]).then(
      ([steps, repos]) => {
        setAvailableSteps(steps);
        setAvailableRepos(repos);
      }
    );
  }, []);

  const load = useCallback((f: FilterState, p: number) => {
    const af = toAuditFilters(f);
    startTransition(async () => {
      setLoading(true);
      const [sum, runsRes, fails] = await Promise.all([
        fetchAuditSummary(af),
        fetchAuditRuns({
          ...af,
          limit: RUNS_PAGE_SIZE,
          offset: p * RUNS_PAGE_SIZE,
        }),
        fetchAuditFailures(af),
      ]);
      setSummary(sum);
      setRuns(runsRes.runs);
      setRunsTotal(runsRes.total);
      setFailures(fails);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    load(applied, page);
  }, [load, applied, page]);

  const apply = useCallback((next: FilterState) => {
    setApplied(next);
    setDraft(next);
    setPage(0);
  }, []);

  const onApply = useCallback(() => apply(draft), [apply, draft]);

  const onClear = useCallback(() => {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setPage(0);
  }, []);

  const onToggleRepoApplied = useCallback(
    (repo: string) => {
      const next = { ...applied, repos: toggle(applied.repos, repo) };
      setDraft(next);
      apply(next);
    },
    [applied, apply]
  );

  const onToggleStepApplied = useCallback(
    (step: string) => {
      const next = { ...applied, steps: toggle(applied.steps, step) };
      setDraft(next);
      apply(next);
    },
    [applied, apply]
  );

  const onFilterErrors = useCallback(() => {
    apply({ ...EMPTY_FILTERS, statuses: ["error"] });
  }, [apply]);

  const exportCsv = useCallback(() => {
    const af = toAuditFilters(applied);
    const params = new URLSearchParams();
    if (af.runId) {
      params.set("runId", af.runId);
    }
    for (const s of af.steps ?? []) {
      params.append("step", s);
    }
    for (const r of af.repos ?? []) {
      params.append("repo", r);
    }
    if (af.dateFrom) {
      params.set("dateFrom", af.dateFrom);
    }
    if (af.dateTo) {
      params.set("dateTo", af.dateTo);
    }
    window.location.href = `/api/audit/export?${params.toString()}`;
  }, [applied]);

  const totalPages = Math.ceil(runsTotal / RUNS_PAGE_SIZE);
  const windowLabel =
    summary?.windowStart && summary.windowEnd
      ? `${summary.windowStart.slice(0, 10)} → ${summary.windowEnd.slice(0, 10)}`
      : "—";

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      <header>
        <h1 className="flex items-center gap-2 font-semibold text-xl">
          <ShieldCheck className="size-5 text-[#00d4a0]" /> Audit Log
        </h1>
        <p className="max-w-3xl text-muted-foreground text-sm">
          The forensic record of every action TARS took on a PR review —
          cite-or-it-didn&apos;t-happen. Grouped by run so the sequence reads as
          a story; expand any run for its step timeline and the exact payload
          TARS acted on. Window: {windowLabel}.
        </p>
      </header>

      {summary ? (
        <>
          <StatusBanner summary={summary} />
          <HeroBand
            onFilterErrors={onFilterErrors}
            onFilterFailures={onFilterErrors}
            summary={summary}
          />
          <ActivityBreakdowns
            byHour={summary.byHour}
            byRepo={summary.byRepo}
            byStep={summary.byStep}
            onToggleRepo={onToggleRepoApplied}
            onToggleStep={onToggleStepApplied}
            selectedRepos={applied.repos}
            selectedSteps={applied.steps}
          />
        </>
      ) : null}

      <FilterBar
        availableRepos={availableRepos}
        availableSteps={availableSteps}
        onApply={onApply}
        onClear={onClear}
        onDateFromChange={(v) => setDraft((d) => ({ ...d, dateFrom: v }))}
        onDateToChange={(v) => setDraft((d) => ({ ...d, dateTo: v }))}
        onExport={exportCsv}
        onRefresh={() => load(applied, page)}
        onSearchChange={(v) => setDraft((d) => ({ ...d, search: v }))}
        onToggleRepo={(v) =>
          setDraft((d) => ({ ...d, repos: toggle(d.repos, v) }))
        }
        onToggleStatus={(v) =>
          setDraft((d) => ({ ...d, statuses: toggle(d.statuses, v) }))
        }
        onToggleStep={(v) =>
          setDraft((d) => ({ ...d, steps: toggle(d.steps, v) }))
        }
        pending={isPending}
        state={draft}
      />

      <FailuresSpotlight failures={failures} />

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-muted-foreground text-sm uppercase tracking-wide">
            Run-grouped activity · {runsTotal.toLocaleString()} run
            {runsTotal === 1 ? "" : "s"}
          </h2>
        </div>

        {loading && runs.length === 0 ? (
          <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground text-sm">
            Loading runs…
          </div>
        ) : null}
        {!loading && runs.length === 0 ? (
          <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground text-sm">
            No runs match the current filters.
          </div>
        ) : null}

        <div className="space-y-2">
          {runs.map((run) => (
            <RunCard key={run.runId} run={run} />
          ))}
        </div>

        {totalPages > 1 ? (
          <div className="flex items-center justify-between text-muted-foreground text-sm">
            <span className="tabular-nums">
              Page {page + 1} of {totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                size="sm"
                variant="outline"
              >
                Previous
              </Button>
              <Button
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                size="sm"
                variant="outline"
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
