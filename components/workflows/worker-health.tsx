import { Activity, Cpu, ExternalLink, ServerCog } from "lucide-react";
import type { JobStats, WorkerHealth } from "@/lib/tars/workflows";
import { cn } from "@/lib/utils";
import { ageFromMs, formatDuration, relativeTime } from "./shared";

const JOB_STATUS_CLS: Record<string, string> = {
  done: "bg-[#00d4a0]",
  running: "bg-blue-400",
  queued: "bg-sky-400",
  failed: "bg-red-500",
  cancelled: "bg-zinc-600",
};

const JOB_STATUS_TEXT: Record<string, string> = {
  done: "text-[#00d4a0]",
  running: "text-blue-400",
  queued: "text-sky-400",
  failed: "text-red-400",
  cancelled: "text-zinc-400",
};

const JOB_STATUS_ORDER = ["queued", "running", "done", "failed", "cancelled"];

export function WorkerHealthTile({ worker }: { worker: WorkerHealth }) {
  const online = worker.online;
  let lastSeenLabel = "never";
  if (worker.lastSeenMs !== null) {
    lastSeenLabel = `${ageFromMs(worker.lastSeenMs)} ago`;
  }
  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-4",
        online ? "" : "border-red-500/40"
      )}
    >
      <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
        <ServerCog className="size-4" /> Durable executor
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span
          className={cn(
            "size-2.5 rounded-full",
            online ? "bg-[#00d4a0]" : "bg-red-500"
          )}
        />
        <span
          className={cn(
            "font-semibold text-lg",
            online ? "text-[#00d4a0]" : "text-red-400"
          )}
        >
          {online ? "Online" : "Offline"}
        </span>
        <span className="text-muted-foreground text-sm tabular-nums">
          · {lastSeenLabel}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <div className="text-muted-foreground">Worker</div>
          <div className="truncate font-mono">{worker.workerId ?? "—"}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Version</div>
          <div className="font-mono">{worker.version ?? "—"}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Uptime</div>
          <div className="tabular-nums">
            {worker.uptimeMs === null ? "—" : ageFromMs(worker.uptimeMs)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Host</div>
          <div className="truncate font-mono">{worker.hostname ?? "—"}</div>
        </div>
      </div>
      {online ? null : (
        <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-red-300 text-xs">
          The executor that runs every durable step is not reporting. Queued
          work will not drain until it returns.
        </p>
      )}
    </div>
  );
}

export function QueueHealthTile({ jobs }: { jobs: JobStats }) {
  const total = jobs.total;
  const failTone = jobs.failureRate > 5 ? "text-amber-400" : "text-[#00d4a0]";
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
          <Cpu className="size-4" /> Job queue
        </div>
        <span className={cn("font-medium text-xs tabular-nums", failTone)}>
          {jobs.failureRate}% fail
        </span>
      </div>

      {/* Stacked bar */}
      <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-muted">
        {JOB_STATUS_ORDER.map((s) => {
          const n = jobs.byStatus[s] ?? 0;
          if (n === 0 || total === 0) {
            return null;
          }
          return (
            <div
              className={cn("h-full", JOB_STATUS_CLS[s])}
              key={s}
              style={{ width: `${(n / total) * 100}%` }}
              title={`${s}: ${n}`}
            />
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {JOB_STATUS_ORDER.map((s) => {
          const n = jobs.byStatus[s] ?? 0;
          if (n === 0) {
            return null;
          }
          return (
            <span className="flex items-center gap-1" key={s}>
              <span
                className={cn("size-1.5 rounded-full", JOB_STATUS_CLS[s])}
              />
              <span className="text-muted-foreground capitalize">{s}</span>
              <span className={cn("tabular-nums", JOB_STATUS_TEXT[s])}>
                {n}
              </span>
            </span>
          );
        })}
      </div>

      {/* By-kind durations */}
      <div className="mt-3 space-y-1 border-t pt-3">
        {jobs.byKind.map((k) => (
          <div
            className="flex items-center justify-between text-xs"
            key={k.kind}
          >
            <span className="font-mono text-muted-foreground">{k.kind}</span>
            <span className="flex items-center gap-3 tabular-nums">
              <span title="failed / total">
                {k.failed > 0 ? (
                  <span className="text-red-400">{k.failed}</span>
                ) : (
                  <span className="text-[#00d4a0]">0</span>
                )}
                <span className="text-muted-foreground"> / {k.total}</span>
              </span>
              <span className="flex items-center gap-1 text-muted-foreground">
                <Activity className="size-3" />
                {formatDuration(k.avgDurationMs)}
              </span>
            </span>
          </div>
        ))}
      </div>

      {jobs.recentFailures.length > 0 ? (
        <details className="mt-3 border-t pt-3">
          <summary className="cursor-pointer text-muted-foreground text-xs hover:text-foreground">
            Recent failed jobs ({jobs.recentFailures.length})
          </summary>
          <div className="mt-2 space-y-1.5">
            {jobs.recentFailures.map((f) => (
              <div
                className="rounded-lg border border-red-500/20 bg-red-500/5 px-2 py-1.5 text-xs"
                key={f.id}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-red-300">{f.kind}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {f.attempts}/{f.maxAttempts} attempts ·{" "}
                    {relativeTime(f.createdAt)}
                  </span>
                </div>
                {f.errorText ? (
                  <p className="mt-1 line-clamp-2 text-muted-foreground">
                    {f.errorText}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

export function ExternalChip({ href, label }: { href: string; label: string }) {
  return (
    <a
      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-muted-foreground text-xs transition-colors hover:border-[#00d4a0]/50 hover:text-foreground"
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      {label} <ExternalLink className="size-3" />
    </a>
  );
}
