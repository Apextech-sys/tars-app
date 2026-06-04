import { ArrowRight, Clock } from "lucide-react";
import Link from "next/link";
import type { WorkflowFleetEntry } from "@/lib/tars/workflows";
import { cn } from "@/lib/utils";
import { formatDuration, relativeTime, workflowIcon } from "./shared";

/** Status dot colour for a fleet entry: red if stalled, teal if active, else grey. */
function statusDotClass(wf: WorkflowFleetEntry): string {
  if (wf.stalled > 0) {
    return "bg-red-500";
  }
  if (wf.isActive) {
    return "bg-[#00d4a0]";
  }
  return "bg-zinc-600";
}

function StatChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "warn" | "bad";
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
    <div className="flex flex-col">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
        {label}
      </span>
      <span className={cn("font-medium text-sm tabular-nums", toneCls)}>
        {value}
      </span>
    </div>
  );
}

export function WorkflowFleetCard({ wf }: { wf: WorkflowFleetEntry }) {
  const Icon = workflowIcon(wf.icon);
  const maxBar = Math.max(1, ...wf.runs14d.map((d) => d.count));
  const needsHuman = wf.pendingApproval + wf.disagreed;
  let successTone: "good" | "warn" | "bad" | undefined;
  if (wf.successRate !== null) {
    if (wf.successRate >= 90) {
      successTone = "good";
    } else if (wf.successRate >= 60) {
      successTone = "warn";
    } else {
      successTone = "bad";
    }
  }

  return (
    <Link
      className={cn(
        "group flex flex-col rounded-xl border bg-card p-4 transition-colors hover:border-[#00d4a0]/50",
        wf.isActive ? "" : "opacity-70"
      )}
      href={`/workflows/${wf.key}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "flex size-8 items-center justify-center rounded-lg",
              wf.isActive
                ? "bg-[#00d4a0]/10 text-[#00d4a0]"
                : "bg-muted text-muted-foreground"
            )}
          >
            <Icon className="size-4" />
          </span>
          <div>
            <div className="flex items-center gap-2 font-semibold text-sm">
              {wf.label}
              <span
                className={cn("size-1.5 rounded-full", statusDotClass(wf))}
              />
            </div>
            <div className="text-[11px] text-muted-foreground">
              {wf.triggerLabel}
            </div>
          </div>
        </div>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </div>

      <p className="mt-3 line-clamp-2 text-muted-foreground text-xs leading-relaxed">
        {wf.description}
      </p>

      {/* Pipeline step pills */}
      <div className="mt-3 flex flex-wrap items-center gap-1">
        {wf.steps.map((s, i) => (
          <span className="flex items-center gap-1" key={s}>
            <span className="rounded-md border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {s}
            </span>
            {i < wf.steps.length - 1 ? (
              <span className="text-[8px] text-muted-foreground/40">›</span>
            ) : null}
          </span>
        ))}
      </div>

      {/* 14-day run sparkline */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground uppercase tracking-wide">
          <span>14-day runs</span>
          {wf.lastRunAt ? (
            <span className="flex items-center gap-1 normal-case">
              <Clock className="size-3" /> {relativeTime(wf.lastRunAt)}
            </span>
          ) : (
            <span className="normal-case">No runs yet</span>
          )}
        </div>
        <div className="mt-1 flex h-10 items-end gap-px">
          {wf.runs14d.map((d) => (
            <div
              className={cn(
                "flex-1 rounded-t",
                d.count > 0 ? "bg-[#00d4a0]/70" : "bg-muted"
              )}
              key={d.date}
              style={{
                height: `${d.count > 0 ? Math.max(8, (d.count / maxBar) * 100) : 4}%`,
              }}
              title={`${d.date}: ${d.count} run${d.count === 1 ? "" : "s"}`}
            />
          ))}
        </div>
      </div>

      {/* Footer stats */}
      {wf.isActive ? (
        <div className="mt-3 grid grid-cols-4 gap-2 border-t pt-3">
          <StatChip label="Runs" value={String(wf.runsTotal)} />
          <StatChip
            label="Success"
            tone={successTone}
            value={wf.successRate === null ? "—" : `${wf.successRate}%`}
          />
          <StatChip label="Mean" value={formatDuration(wf.meanDurationMs)} />
          <StatChip
            label="Awaiting"
            tone={needsHuman > 0 ? "warn" : undefined}
            value={String(needsHuman)}
          />
        </div>
      ) : (
        <div className="mt-3 border-t pt-3 text-[11px] text-muted-foreground">
          Defined in <span className="font-mono">{wf.sourceFile}</span> · no
          runs yet
        </div>
      )}
    </Link>
  );
}
