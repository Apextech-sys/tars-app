"use client";

import { JsonTree } from "@/components/pr-runs/json-tree";
import { Badge } from "@/components/ui/badge";
import type { AuditStep } from "../actions";
import {
  humanizeStep,
  statusDot,
  statusVariant,
  stepIcon,
  stepLabel,
} from "../lib/humanize";

const TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function relTime(fromIso: string, toIso: string): string {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  const s = Math.round(ms / 1000);
  if (s <= 0) {
    return "0s";
  }
  if (s < 60) {
    return `${s}s`;
  }
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
}

export function StepTimeline({ steps }: { steps: AuditStep[] }) {
  if (steps.length === 0) {
    return (
      <p className="px-2 py-3 text-muted-foreground text-xs">
        No steps recorded for this run.
      </p>
    );
  }
  const first = steps[0];

  return (
    <ol className="relative space-y-3 py-1 pl-1">
      {steps.map((s, i) => {
        const Icon = stepIcon(s.step);
        const summary = humanizeStep(s.step, s.status, s.data, s.message);
        const since = first ? relTime(first.createdAt, s.createdAt) : "0s";
        const isLast = i === steps.length - 1;
        return (
          <li className="relative flex gap-3" key={s.id}>
            <div className="flex flex-col items-center">
              <span
                className={`mt-1 size-2.5 shrink-0 rounded-full ${statusDot(s.status)}`}
              />
              {isLast ? null : <span className="mt-1 w-px flex-1 bg-border" />}
            </div>
            <div className="min-w-0 flex-1 pb-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="font-medium text-sm">{stepLabel(s.step)}</span>
                <Badge variant={statusVariant(s.status)}>{s.status}</Badge>
                <span className="font-mono text-muted-foreground text-xs tabular-nums">
                  +{since}
                </span>
                <span
                  className="ml-auto font-mono text-muted-foreground/70 text-xs tabular-nums"
                  title={new Date(s.createdAt).toISOString()}
                >
                  {TIME_FMT.format(new Date(s.createdAt))}
                </span>
              </div>
              <p className="mt-0.5 break-words text-muted-foreground text-sm">
                {summary}
              </p>
              {s.data ? (
                <details className="group mt-1.5">
                  <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[#00d4a0] text-xs hover:underline">
                    <span className="group-open:hidden">view payload</span>
                    <span className="hidden group-open:inline">
                      hide payload
                    </span>
                  </summary>
                  <div className="mt-1.5 rounded-md border bg-muted/30 p-2">
                    <JsonTree data={s.data} />
                  </div>
                </details>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
