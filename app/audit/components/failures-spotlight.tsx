"use client";

import { AlertOctagon } from "lucide-react";
import type { AuditFailure } from "../actions";

const TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function jumpToRun(runId: string) {
  const el = document.getElementById(`run-${runId}`);
  if (el instanceof HTMLDetailsElement) {
    el.open = true;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

export function FailuresSpotlight({ failures }: { failures: AuditFailure[] }) {
  if (failures.length === 0) {
    return null;
  }

  return (
    <details className="rounded-xl border border-red-500/30 bg-red-500/5" open>
      <summary className="flex cursor-pointer list-none items-center gap-2 p-4 font-medium text-red-400 text-sm">
        <AlertOctagon className="size-4" />
        Failures spotlight · {failures.length} error
        {failures.length === 1 ? "" : "s"} in window
      </summary>
      <div className="space-y-1 border-red-500/20 border-t px-4 pt-3 pb-4">
        {failures.map((f) => (
          <div
            className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-md px-2 py-1.5 text-xs hover:bg-red-500/10"
            key={f.id}
          >
            <span className="font-medium">
              {f.repo ?? "unknown"}
              {f.prNumber === null ? null : (
                <span className="text-muted-foreground"> #{f.prNumber}</span>
              )}
            </span>
            <span className="rounded bg-red-500/15 px-1.5 py-0.5 font-mono text-red-300">
              {f.step}
            </span>
            <span className="min-w-0 flex-1 break-words text-muted-foreground">
              {f.detail}
            </span>
            <span className="font-mono text-muted-foreground/70 tabular-nums">
              {TIME_FMT.format(new Date(f.createdAt))}
            </span>
            <button
              className="text-[#00d4a0] hover:underline"
              onClick={() => jumpToRun(f.runId)}
              type="button"
            >
              jump to run
            </button>
          </div>
        ))}
      </div>
    </details>
  );
}
