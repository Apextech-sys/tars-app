"use client";

/**
 * BriefTimeline — day-grouped, scannable list of past briefs replacing the
 * old flat <ul>. Client-side kind/status filtering over already-loaded rows,
 * per-row metric chips (act-insights · actions · questions · replies), and a
 * failed-brief card that expands its error_text inline rather than navigating
 * to a dead detail page.
 */

import type { LucideIcon } from "lucide-react";
import {
  CircleAlert,
  MessageSquare,
  Sunrise,
  Sunset,
  TriangleAlert,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

export interface TimelineRow {
  id: string;
  date: string;
  kind: "morning" | "evening" | "adhoc";
  status: "pending" | "composing" | "ready" | "failed";
  summary: string | null;
  errorText: string | null;
  stamp: string;
  actInsights: number;
  actionCount: number;
  questionCount: number;
  replyCount: number;
}

type KindFilter = "all" | "morning" | "evening" | "adhoc";
type StatusFilter = "all" | "ready" | "issues";

const KIND_ICON: Record<TimelineRow["kind"], LucideIcon> = {
  morning: Sunrise,
  evening: Sunset,
  adhoc: Zap,
};

const STATUS_CHIP: Record<TimelineRow["status"], string> = {
  pending: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  composing: "border-sky-500/30 bg-sky-500/10 text-sky-400",
  ready: "border-[#00d4a0]/30 bg-[#00d4a0]/10 text-[#00d4a0]",
  failed: "border-red-500/30 bg-red-500/10 text-red-400",
};

const KIND_OPTIONS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "morning", label: "Morning" },
  { value: "evening", label: "Evening" },
  { value: "adhoc", label: "Adhoc" },
];

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "ready", label: "Ready" },
  { value: "issues", label: "Issues" },
];

const DEFAULT_VISIBLE_DAYS = 7;

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border bg-card p-0.5">
      {options.map((opt) => (
        <button
          className={cn(
            "rounded-md px-3 py-1 text-xs transition-colors",
            value === opt.value
              ? "bg-[#00d4a0]/15 text-[#00d4a0]"
              : "text-muted-foreground hover:text-foreground"
          )}
          key={opt.value}
          onClick={() => onChange(opt.value)}
          type="button"
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function MetricChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "bad" | "warn" | "neutral";
}) {
  if (value === 0) {
    return null;
  }
  let cls = "text-muted-foreground";
  if (tone === "bad") {
    cls = "text-red-400";
  } else if (tone === "warn") {
    cls = "text-amber-400";
  }
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", cls)}>
      <span className="font-medium tabular-nums">{value}</span>
      {label}
    </span>
  );
}

function FailedCard({ row }: { row: TimelineRow }) {
  const Icon = KIND_ICON[row.kind];
  return (
    <details className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm">
          <Icon className="size-4 text-red-400" />
          <span className="font-medium">{row.date}</span>
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-xs uppercase tracking-wide",
              STATUS_CHIP.failed
            )}
          >
            failed
          </span>
        </span>
        <span className="flex items-center gap-1 text-red-400 text-xs">
          <TriangleAlert className="size-3.5" /> view error
        </span>
      </summary>
      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-black/40 p-3 text-red-300 text-xs">
        {row.errorText ?? "No error detail recorded."}
      </pre>
    </details>
  );
}

function BriefCard({ row }: { row: TimelineRow }) {
  if (row.status === "failed") {
    return <FailedCard row={row} />;
  }
  const Icon = KIND_ICON[row.kind];
  const summaryText =
    row.summary ?? (row.status === "ready" ? "(no summary)" : "Composing…");
  return (
    <Link
      className="block rounded-xl border bg-card p-4 transition-colors hover:border-[#00d4a0]/40 hover:bg-card/80"
      href={`/briefs/${row.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-[#00d4a0]" />
          <span className="font-medium text-sm">{row.date}</span>
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-xs uppercase tracking-wide",
              STATUS_CHIP[row.status]
            )}
          >
            {row.status}
          </span>
        </div>
        <span className="shrink-0 text-muted-foreground text-xs">
          {row.stamp}
        </span>
      </div>
      <p className="mt-2 line-clamp-2 text-muted-foreground text-sm">
        {summaryText}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <MetricChip label="act" tone="bad" value={row.actInsights} />
        <MetricChip label="actions" value={row.actionCount} />
        <MetricChip label="questions" tone="warn" value={row.questionCount} />
        {row.replyCount > 0 ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
            <MessageSquare className="size-3" />
            <span className="font-medium tabular-nums">{row.replyCount}</span>
          </span>
        ) : null}
      </div>
    </Link>
  );
}

export function BriefTimeline({ rows }: { rows: TimelineRow[] }) {
  const [kind, setKind] = useState<KindFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [showAll, setShowAll] = useState(false);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (kind !== "all" && r.kind !== kind) {
        return false;
      }
      if (status === "ready" && r.status !== "ready") {
        return false;
      }
      if (status === "issues" && r.status === "ready") {
        return false;
      }
      return true;
    });
  }, [rows, kind, status]);

  const groups = useMemo(() => {
    const m = new Map<string, TimelineRow[]>();
    for (const r of filtered) {
      const list = m.get(r.date) ?? [];
      list.push(r);
      m.set(r.date, list);
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  const visibleGroups = showAll
    ? groups
    : groups.slice(0, DEFAULT_VISIBLE_DAYS);
  const hiddenCount = groups.length - visibleGroups.length;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold text-base">
          <CircleAlert className="size-4 text-[#00d4a0]" /> Brief timeline
          <span className="rounded-full border bg-muted/40 px-2 py-0.5 font-normal text-muted-foreground text-xs tabular-nums">
            {filtered.length}
          </span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            onChange={setKind}
            options={KIND_OPTIONS}
            value={kind}
          />
          <SegmentedControl
            onChange={setStatus}
            options={STATUS_OPTIONS}
            value={status}
          />
        </div>
      </div>

      {visibleGroups.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-card/40 p-6 text-center text-muted-foreground text-sm">
          No briefs match the active filters.
        </p>
      ) : (
        <div className="space-y-6">
          {visibleGroups.map(([date, dayRows]) => (
            <div className="space-y-2" key={date}>
              <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                {date}
              </h3>
              <div className="grid gap-2 md:grid-cols-2">
                {dayRows.map((row) => (
                  <BriefCard key={row.id} row={row} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {hiddenCount > 0 ? (
        <button
          className="w-full rounded-xl border border-dashed bg-card/40 py-2 text-muted-foreground text-sm transition-colors hover:border-[#00d4a0]/40 hover:text-foreground"
          onClick={() => setShowAll(true)}
          type="button"
        >
          Load {hiddenCount} older day{hiddenCount === 1 ? "" : "s"}
        </button>
      ) : null}
    </section>
  );
}
