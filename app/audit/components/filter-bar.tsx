"use client";

import { Download, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface FilterState {
  search: string;
  repos: string[];
  steps: string[];
  statuses: string[];
  dateFrom: string;
  dateTo: string;
}

const STATUS_VALUES = ["ok", "start", "skip", "info", "error"];

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
        active
          ? "border-[#00d4a0] bg-[#00d4a0]/15 text-[#00d4a0]"
          : "border-border bg-muted hover:bg-accent"
      )}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

export function FilterBar({
  state,
  availableRepos,
  availableSteps,
  pending,
  onSearchChange,
  onToggleRepo,
  onToggleStep,
  onToggleStatus,
  onDateFromChange,
  onDateToChange,
  onApply,
  onClear,
  onRefresh,
  onExport,
}: {
  state: FilterState;
  availableRepos: string[];
  availableSteps: string[];
  pending: boolean;
  onSearchChange: (v: string) => void;
  onToggleRepo: (v: string) => void;
  onToggleStep: (v: string) => void;
  onToggleStatus: (v: string) => void;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  onApply: () => void;
  onClear: () => void;
  onRefresh: () => void;
  onExport: () => void;
}) {
  const activeCount =
    state.repos.length +
    state.steps.length +
    state.statuses.length +
    (state.search ? 1 : 0) +
    (state.dateFrom ? 1 : 0) +
    (state.dateTo ? 1 : 0);

  return (
    <div className="sticky top-2 z-10 space-y-3 rounded-xl border bg-card/95 p-4 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full min-w-0 flex-1 sm:min-w-[220px]">
          <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-8"
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onApply();
              }
            }}
            placeholder="Search run_id or PR…"
            value={state.search}
          />
        </div>
        <Input
          className="w-full sm:w-auto"
          onChange={(e) => onDateFromChange(e.target.value)}
          title="From date"
          type="date"
          value={state.dateFrom}
        />
        <Input
          className="w-full sm:w-auto"
          onChange={(e) => onDateToChange(e.target.value)}
          title="To date"
          type="date"
          value={state.dateTo}
        />
        <Button onClick={onApply} size="sm">
          Apply
        </Button>
        <Button
          disabled={pending}
          onClick={onRefresh}
          size="sm"
          variant="outline"
        >
          <RefreshCw className={cn("size-4", pending && "animate-spin")} />
          Refresh
        </Button>
        <Button onClick={onExport} size="sm" variant="outline">
          <Download className="size-4" /> Export CSV
        </Button>
      </div>

      <details className="sm:open space-y-3" open>
        <summary className="cursor-pointer list-none font-medium text-muted-foreground text-xs sm:hidden">
          Filters{activeCount > 0 ? ` · ${activeCount} active` : ""}
        </summary>
        <div className="space-y-2">
          {availableRepos.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-muted-foreground text-xs">Repo</span>
              {availableRepos.map((r) => (
                <Chip
                  active={state.repos.includes(r)}
                  key={r}
                  label={r}
                  onClick={() => onToggleRepo(r)}
                />
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-muted-foreground text-xs">Status</span>
            {STATUS_VALUES.map((s) => (
              <Chip
                active={state.statuses.includes(s)}
                key={s}
                label={s}
                onClick={() => onToggleStatus(s)}
              />
            ))}
          </div>
          {availableSteps.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-muted-foreground text-xs">Step</span>
              {availableSteps.map((s) => (
                <Chip
                  active={state.steps.includes(s)}
                  key={s}
                  label={s}
                  onClick={() => onToggleStep(s)}
                />
              ))}
            </div>
          ) : null}
        </div>
      </details>

      {activeCount > 0 ? (
        <div className="flex items-center gap-2 border-t pt-2">
          <span className="text-muted-foreground text-xs">
            {activeCount} filter{activeCount === 1 ? "" : "s"} active
          </span>
          <button
            className="inline-flex items-center gap-1 text-[#00d4a0] text-xs hover:underline"
            onClick={onClear}
            type="button"
          >
            <X className="size-3" /> clear all
          </button>
        </div>
      ) : null}
    </div>
  );
}
