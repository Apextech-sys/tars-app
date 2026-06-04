import { ArrowLeft, GitBranch } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import {
  ApprovalGate,
  DisagreementGate,
} from "@/components/workflows/run-actions";
import { RunTimeline } from "@/components/workflows/run-timeline";
import {
  formatDuration,
  relativeTime,
  statusMeta,
} from "@/components/workflows/shared";
import { ExternalChip } from "@/components/workflows/worker-health";
import { getRunTimeline } from "@/lib/tars/workflows";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

function StatCell({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
        {label}
      </div>
      <div className="mt-0.5 font-medium text-sm tabular-nums">{value}</div>
    </div>
  );
}

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const run = await getRunTimeline(runId);
  if (!run) {
    notFound();
  }

  const meta = statusMeta(run.status);
  const githubUrl = `https://github.com/${run.owner}/${run.repo}/pull/${run.prNumber}`;
  const okSteps = run.steps.filter(
    (s) => s.status === "ok" || s.status === "info" || s.status === "skip"
  ).length;
  const errored = run.steps.some((s) => s.status === "error");
  const isStalled =
    run.status === "started" &&
    Date.now() - new Date(run.updatedAt).getTime() > 15 * 60 * 1000;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <Link
        className="inline-flex items-center gap-1.5 text-muted-foreground text-sm hover:text-foreground"
        href="/workflows"
      >
        <ArrowLeft className="size-4" /> Workflows
      </Link>

      {/* Header */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <GitBranch className="size-5 text-[#00d4a0]" />
          <h1 className="font-semibold text-xl">
            {run.repo} #{run.prNumber}
          </h1>
          {run.prSha ? (
            <span className="font-mono text-muted-foreground text-sm">
              {run.prSha.slice(0, 7)}
            </span>
          ) : null}
          <span
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-xs",
              meta.cls
            )}
          >
            {meta.label}
          </span>
          {isStalled ? (
            <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-red-400 text-xs">
              stalled
            </span>
          ) : null}
        </div>
        <p className="text-muted-foreground text-sm">
          {run.prTitle ?? "pr-review workflow"} ·{" "}
          <span className="font-mono">{run.workflowKey}</span> · {run.owner}
          {run.senderLogin ? ` · opened by ${run.senderLogin}` : ""}
        </p>

        {/* At-a-glance strip */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
          <StatCell label="Duration" value={formatDuration(run.durationMs)} />
          <StatCell label="Findings" value={run.findingsCount} />
          <StatCell label="Steps" value={`${okSteps}/${run.steps.length}`} />
          <StatCell label="Jobs" value={run.jobs.length} />
          <StatCell label="Started" value={relativeTime(run.createdAt)} />
        </div>

        {/* Secondary deep-links */}
        <div className="flex flex-wrap gap-2">
          <ExternalChip href={githubUrl} label={`GitHub PR #${run.prNumber}`} />
          {run.linearIssueUrl ? (
            <ExternalChip
              href={run.linearIssueUrl}
              label={run.linearIssueIdentifier ?? "Linear issue"}
            />
          ) : null}
          {run.reviewCommentUrl ? (
            <ExternalChip href={run.reviewCommentUrl} label="Review comment" />
          ) : null}
          {run.fixPrUrl ? (
            <ExternalChip href={run.fixPrUrl} label="Fix PR" />
          ) : null}
        </div>
      </div>

      {/* Action gate */}
      {run.status === "pending-approval" ? (
        <ApprovalGate findingsCount={run.findingsCount} runId={run.runId} />
      ) : null}
      {run.status === "disagreed" ? (
        <DisagreementGate runId={run.runId} />
      ) : null}

      {/* Error banner */}
      {errored && run.error ? (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-300 text-sm">
          <div className="font-medium">Run errored</div>
          <p className="mt-1 text-red-300/80 text-xs">{run.error}</p>
        </div>
      ) : null}

      {/* Durable timeline */}
      <section className="space-y-3">
        <h2 className="font-semibold text-lg">Durable step timeline</h2>
        <div className="rounded-xl border bg-card p-4">
          <RunTimeline jobs={run.jobs} steps={run.steps} />
        </div>
      </section>
    </div>
  );
}
