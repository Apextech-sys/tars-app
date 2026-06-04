"use client";

import { AlertTriangle, Bell, ChevronRight, Timer, X, Zap } from "lucide-react";
import { useTransition } from "react";
import type { InboxItem } from "@/app/inbox/actions";
import { dismissInboxItem } from "@/app/inbox/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function relativeAge(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) {
    return "just now";
  }
  if (mins < 60) {
    return `${mins}m ago`;
  }
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) {
    return `${hrs}h ago`;
  }
  return `${Math.floor(hrs / 24)}d ago`;
}

function DismissButton({
  id,
  label,
  onAction,
}: {
  id: string;
  label: string;
  onAction: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      aria-label={label}
      className="h-7 px-2 text-muted-foreground text-xs"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          await dismissInboxItem(id);
          onAction();
        });
      }}
      size="sm"
      variant="ghost"
    >
      <X className="size-3" />
      Dismiss
    </Button>
  );
}

function StaleChip() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 font-medium text-[10px] text-red-400 uppercase">
      <AlertTriangle className="size-3" /> Stale
    </span>
  );
}

function WorkerFailureRow({
  item,
  onAction,
}: {
  item: Extract<InboxItem, { kind: "worker_failure" }>;
  onAction: () => void;
}) {
  return (
    <details className="group rounded-lg border bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-2 p-3">
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        <Zap className="size-4 shrink-0 text-red-400" />
        <span className="font-medium font-mono text-sm">{item.jobKind}</span>
        <span className="text-muted-foreground text-xs tabular-nums">
          · {item.count} failed · newest {relativeAge(item.ageMs)}
        </span>
        {item.stale ? <StaleChip /> : null}
        <span className="ml-auto flex items-center gap-2">
          <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground text-xs tabular-nums">
            {item.worstAttempts} attempt{item.worstAttempts === 1 ? "" : "s"}
          </span>
          <DismissButton
            id={item.id}
            label={`Dismiss ${item.jobKind} failures`}
            onAction={onAction}
          />
        </span>
      </summary>
      {item.sampleError ? (
        <pre className="mx-3 mb-3 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted/60 p-2.5 font-mono text-[11px] text-red-400 leading-relaxed">
          {item.sampleError}
        </pre>
      ) : (
        <p className="mx-3 mb-3 text-muted-foreground text-xs">
          No error text recorded.
        </p>
      )}
    </details>
  );
}

function StallRow({
  item,
  onAction,
}: {
  item: Extract<InboxItem, { kind: "workflow_stall" }>;
  onAction: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 text-sm">
      <Timer
        className={cn(
          "size-4 shrink-0",
          item.stale ? "text-red-400" : "text-amber-400"
        )}
      />
      <span className="font-mono">
        {item.owner}/{item.repo}
        <span className="text-muted-foreground"> #{item.prNumber}</span>
      </span>
      <span className="text-muted-foreground text-xs tabular-nums">
        running for {relativeAge(item.ageMs)}
      </span>
      {item.stale ? <StaleChip /> : null}
      <span className="ml-auto flex items-center gap-2">
        <a
          className="inline-flex min-h-[28px] items-center gap-1 rounded-md px-2 py-1 text-muted-foreground text-xs hover:bg-accent hover:text-foreground"
          href={`/pr-runs/${encodeURIComponent(item.runId)}`}
        >
          Run detail
        </a>
        <DismissButton
          id={item.id}
          label="Dismiss stalled run"
          onAction={onAction}
        />
      </span>
    </div>
  );
}

function ErrorRow({
  item,
  onAction,
}: {
  item: Extract<InboxItem, { kind: "pr_failure" }>;
  onAction: () => void;
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <AlertTriangle className="size-4 shrink-0 text-red-400" />
        <span className="font-mono">
          {item.owner}/{item.repo}
          <span className="text-muted-foreground"> #{item.prNumber}</span>
        </span>
        <span className="text-muted-foreground text-xs">
          {relativeAge(item.ageMs)}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <a
            className="inline-flex min-h-[28px] items-center gap-1 rounded-md px-2 py-1 text-muted-foreground text-xs hover:bg-accent hover:text-foreground"
            href={`/pr-runs/${encodeURIComponent(item.runId)}`}
          >
            Run detail
          </a>
          <DismissButton
            id={item.id}
            label="Dismiss errored run"
            onAction={onAction}
          />
        </span>
      </div>
      <p className="mt-2 truncate rounded bg-muted/60 px-2 py-1 font-mono text-red-400 text-xs">
        {item.error}
      </p>
    </div>
  );
}

export function FyiColumn({
  items,
  onAction,
}: {
  items: InboxItem[];
  onAction: () => void;
}) {
  const workerFails = items.filter(
    (i): i is Extract<InboxItem, { kind: "worker_failure" }> =>
      i.kind === "worker_failure"
  );
  const stalls = items.filter(
    (i): i is Extract<InboxItem, { kind: "workflow_stall" }> =>
      i.kind === "workflow_stall"
  );
  const errors = items.filter(
    (i): i is Extract<InboxItem, { kind: "pr_failure" }> =>
      i.kind === "pr_failure"
  );

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-12 text-muted-foreground">
        <Bell className="size-6" />
        <p className="text-sm">No system health items — all workers nominal.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {stalls.length > 0 ? (
        <section className="space-y-2">
          <h3 className="flex items-center gap-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
            <Timer className="size-3.5" /> Stalled runs · {stalls.length}
          </h3>
          {stalls.map((item) => (
            <StallRow item={item} key={item.id} onAction={onAction} />
          ))}
        </section>
      ) : null}

      {errors.length > 0 ? (
        <section className="space-y-2">
          <h3 className="flex items-center gap-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
            <AlertTriangle className="size-3.5" /> Errored runs ·{" "}
            {errors.length}
          </h3>
          {errors.map((item) => (
            <ErrorRow item={item} key={item.id} onAction={onAction} />
          ))}
        </section>
      ) : null}

      {workerFails.length > 0 ? (
        <section className="space-y-2">
          <h3 className="flex items-center gap-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
            <Zap className="size-3.5" /> Worker failures · {workerFails.length}{" "}
            group
            {workerFails.length === 1 ? "" : "s"}
          </h3>
          {workerFails.map((item) => (
            <WorkerFailureRow item={item} key={item.id} onAction={onAction} />
          ))}
        </section>
      ) : null}
    </div>
  );
}
