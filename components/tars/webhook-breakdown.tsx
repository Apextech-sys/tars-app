"use client";

import { ChevronDown } from "lucide-react";
import { decodeAction } from "@/lib/tars/webhook-helpers";
import type { WebhookStats } from "@/lib/tars/webhooks-stats";
import { cn } from "@/lib/utils";
import type { WebhookFilter } from "./webhook-hero-band";

interface BarRowProps {
  label: string;
  count: number;
  triggered?: number;
  max: number;
  mono?: boolean;
  onClick: () => void;
}

function BarRow({ label, count, triggered, max, mono, onClick }: BarRowProps) {
  const widthPct = Math.max(2, (count / max) * 100);
  const triggeredPct =
    triggered === undefined || count === 0
      ? 0
      : Math.max(0, (triggered / count) * widthPct);
  return (
    <button
      className="group flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/40"
      onClick={onClick}
      type="button"
    >
      <span
        className={cn(
          "w-40 shrink-0 truncate text-xs group-hover:text-foreground",
          mono ? "font-mono text-muted-foreground" : "text-foreground"
        )}
        title={label}
      >
        {label}
      </span>
      <span className="relative h-3 flex-1 overflow-hidden rounded-full bg-muted/40">
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-[#00d4a0]/30"
          style={{ width: `${widthPct}%` }}
        />
        {triggered === undefined ? null : (
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-[#00d4a0]"
            style={{ width: `${triggeredPct}%` }}
            title={`${triggered} triggered a run`}
          />
        )}
      </span>
      <span className="w-10 shrink-0 text-right text-xs tabular-nums">
        {count.toLocaleString()}
      </span>
    </button>
  );
}

export function WebhookBreakdown({
  stats,
  onFilter,
}: {
  stats: WebhookStats;
  onFilter: (filter: WebhookFilter) => void;
}) {
  const repoMax = Math.max(1, ...stats.byRepo.map((r) => r.count));
  const typeMax = Math.max(1, ...stats.byType.map((t) => t.count));
  const actionMax = Math.max(1, ...stats.topActions.map((a) => a.count));

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="rounded-xl border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-medium text-sm">By source (7d)</h3>
          <span className="text-muted-foreground text-xs">
            teal fill = triggered a run
          </span>
        </div>
        <div className="space-y-0.5">
          {stats.byRepo.map((r) => (
            <BarRow
              count={r.count}
              key={r.repoKey}
              label={r.repoKey}
              max={repoMax}
              mono
              onClick={() => onFilter({ repo: r.repoKey })}
              triggered={r.triggered}
            />
          ))}
        </div>
      </div>

      <div className="rounded-xl border bg-card p-4">
        <h3 className="mb-3 font-medium text-sm">By event type</h3>
        <div className="space-y-0.5">
          {stats.byType.map((t) => (
            <BarRow
              count={t.count}
              key={t.eventType}
              label={t.eventType}
              max={typeMax}
              mono
              onClick={() => onFilter({ event: t.eventType })}
            />
          ))}
        </div>

        <details className="group mt-3 border-border border-t pt-3">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-muted-foreground text-xs hover:text-foreground">
            <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
            Breakdown by action
          </summary>
          <div className="mt-2 space-y-0.5">
            {stats.topActions.map((a) => {
              const decoded = decodeAction(a.action, false);
              return (
                <BarRow
                  count={a.count}
                  key={a.action}
                  label={decoded.label}
                  max={actionMax}
                  onClick={() => onFilter({ action: a.action })}
                />
              );
            })}
          </div>
        </details>
      </div>
    </div>
  );
}
