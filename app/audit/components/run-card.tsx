"use client";

import {
  AlertTriangle,
  ChevronRight,
  ExternalLink,
  GitPullRequest,
  Loader2,
  Ticket,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { type AuditRunGroup, type AuditStep, fetchRunSteps } from "../actions";
import type { BadgeVariant } from "../lib/humanize";
import { StepTimeline } from "./step-timeline";

const OUTCOME_VARIANT: Record<string, BadgeVariant> = {
  "pending-approval": "warning",
  disagreed: "warning",
  "skipped-no-findings": "secondary",
  "skipped-policy": "secondary",
  started: "default",
  error: "destructive",
  "fix-failed": "destructive",
  approved: "success",
  done: "success",
  completed: "success",
  rejected: "secondary",
};

function outcomeVariant(status: string | null): BadgeVariant {
  if (!status) {
    return "default";
  }
  return OUTCOME_VARIANT[status] ?? "default";
}

function dotColor(run: AuditRunGroup): string {
  if (run.hadError || run.runStatus === "error") {
    return "bg-red-500";
  }
  if (run.runStatus === "pending-approval" || run.runStatus === "disagreed") {
    return "bg-amber-500";
  }
  if (run.runStatus === "started") {
    return "bg-sky-400";
  }
  return "bg-[#00d4a0]";
}

function duration(startIso: string, endIso: string): string {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) {
    return `${s}s`;
  }
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) {
    return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
  }
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function relAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60_000);
  if (m < 1) {
    return "just now";
  }
  if (m < 60) {
    return `${m}m ago`;
  }
  const h = Math.floor(m / 60);
  if (h < 24) {
    return `${h}h ago`;
  }
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const STALE_STARTED_MS = 30 * 60_000;

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: breadth of independent branches/panels in one cohesive view-builder, not tangled control flow; splitting would scatter co-located UI logic
export function RunCard({ run }: { run: AuditRunGroup }) {
  const [steps, setSteps] = useState<AuditStep[] | null>(null);
  const [loading, setLoading] = useState(false);

  const onToggle = useCallback(
    (open: boolean) => {
      if (open && steps === null && !loading) {
        setLoading(true);
        fetchRunSteps(run.runId)
          .then(setSteps)
          .finally(() => setLoading(false));
      }
    },
    [run.runId, steps, loading]
  );

  const stale =
    run.runStatus === "started" &&
    Date.now() - new Date(run.endedAt).getTime() > STALE_STARTED_MS;

  const ghUrl =
    run.owner && run.repo && run.prNumber !== null
      ? `https://github.com/${run.owner}/${run.repo}/pull/${run.prNumber}`
      : null;

  return (
    <details
      className="group rounded-xl border bg-card"
      id={`run-${run.runId}`}
      onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-2 p-4">
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        <span className={`size-2.5 shrink-0 rounded-full ${dotColor(run)}`} />
        <span className="font-medium text-sm">
          {run.repo ?? "unknown"}
          {run.prNumber === null ? null : (
            <span className="text-muted-foreground"> #{run.prNumber}</span>
          )}
        </span>
        {run.owner ? (
          <span className="hidden font-mono text-muted-foreground text-xs sm:inline">
            {run.owner}
          </span>
        ) : null}
        {run.runStatus ? (
          <Badge variant={outcomeVariant(run.runStatus)}>{run.runStatus}</Badge>
        ) : null}
        {stale ? (
          <Badge variant="destructive">
            <AlertTriangle className="size-3" /> stale
          </Badge>
        ) : null}
        <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs tabular-nums">
          {run.findingsCount === null ? null : (
            <span>
              {run.findingsCount} finding{run.findingsCount === 1 ? "" : "s"}
            </span>
          )}
          <span>{run.stepCount} steps</span>
          <span>{duration(run.startedAt, run.endedAt)}</span>
          <span title={new Date(run.endedAt).toISOString()}>
            {relAge(run.endedAt)}
          </span>
        </span>
      </summary>

      <div className="border-t px-4 pt-3 pb-4">
        {(ghUrl ||
          run.reviewCommentUrl ||
          run.linearIssueUrl ||
          run.fixPrUrl) && (
          <div className="mb-3 flex flex-wrap gap-2">
            <Link
              className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-muted-foreground text-xs hover:bg-accent"
              href={`/pr-runs/${run.runId}`}
            >
              <GitPullRequest className="size-3" /> Full run detail
            </Link>
            {ghUrl ? (
              <a
                className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-muted-foreground text-xs hover:bg-accent"
                href={ghUrl}
                rel="noreferrer"
                target="_blank"
              >
                <ExternalLink className="size-3" /> GitHub PR
              </a>
            ) : null}
            {run.reviewCommentUrl ? (
              <a
                className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-muted-foreground text-xs hover:bg-accent"
                href={run.reviewCommentUrl}
                rel="noreferrer"
                target="_blank"
              >
                <ExternalLink className="size-3" /> Review comment
              </a>
            ) : null}
            {run.linearIssueUrl ? (
              <a
                className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-muted-foreground text-xs hover:bg-accent"
                href={run.linearIssueUrl}
                rel="noreferrer"
                target="_blank"
              >
                <Ticket className="size-3" /> Linear issue
              </a>
            ) : null}
            {run.fixPrUrl ? (
              <a
                className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-muted-foreground text-xs hover:bg-accent"
                href={run.fixPrUrl}
                rel="noreferrer"
                target="_blank"
              >
                <ExternalLink className="size-3" /> Fix PR
              </a>
            ) : null}
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 py-4 text-muted-foreground text-sm">
            <Loader2 className="size-4 animate-spin" /> Loading step timeline…
          </div>
        ) : null}
        {steps ? <StepTimeline steps={steps} /> : null}
        <p className="mt-2 break-all font-mono text-[10px] text-muted-foreground/50">
          {run.runId}
        </p>
      </div>
    </details>
  );
}
