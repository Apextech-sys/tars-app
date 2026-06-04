import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { RecentRunsTable } from "@/components/workflows/recent-runs-table";
import {
  formatDuration,
  relativeTime,
  workflowIcon,
} from "@/components/workflows/shared";
import { getWorkflowDefinition } from "@/lib/tars/workflow-registry";
import { getWorkflowOverview, getWorkflowRuns } from "@/lib/tars/workflows";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Tone = "neutral" | "good" | "warn" | "bad";
const TONE_ACCENT: Record<Tone, string> = {
  bad: "text-red-400",
  warn: "text-amber-400",
  good: "text-[#00d4a0]",
  neutral: "text-foreground",
};

function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 font-semibold text-2xl tabular-nums",
          TONE_ACCENT[tone]
        )}
      >
        {value}
      </div>
      {sub ? <div className="text-muted-foreground text-xs">{sub}</div> : null}
    </div>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: breadth of independent branches/panels in one cohesive view-builder, not tangled control flow; splitting would scatter co-located UI logic
export default async function WorkflowRunHistoryPage({
  params,
}: {
  params: Promise<{ workflowId: string }>;
}) {
  const { workflowId } = await params;
  const def = getWorkflowDefinition(workflowId);
  if (!def) {
    notFound();
  }

  const [overview, runsResult] = await Promise.all([
    getWorkflowOverview(7),
    getWorkflowRuns({ limit: 25, offset: 0 }),
  ]);
  const entry = overview.fleet.find((f) => f.key === workflowId);
  const Icon = workflowIcon(def.icon);

  // Only pr-review emits runs today; other workflows render their definition
  // plus an honest "no runs yet" state.
  const isPrReview = def.auditWorkflow === "pr-review";
  const runs = isPrReview ? runsResult.runs : [];
  const total = isPrReview ? runsResult.total : 0;

  let successTone: Tone = "neutral";
  if (entry?.successRate != null) {
    if (entry.successRate >= 90) {
      successTone = "good";
    } else if (entry.successRate >= 60) {
      successTone = "warn";
    } else {
      successTone = "bad";
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <Link
        className="inline-flex items-center gap-1.5 text-muted-foreground text-sm hover:text-foreground"
        href="/workflows"
      >
        <ArrowLeft className="size-4" /> Workflow fleet
      </Link>

      {/* Header */}
      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "flex size-10 items-center justify-center rounded-lg",
              entry?.isActive
                ? "bg-[#00d4a0]/10 text-[#00d4a0]"
                : "bg-muted text-muted-foreground"
            )}
          >
            <Icon className="size-5" />
          </span>
          <div>
            <h1 className="font-semibold text-xl">{def.label}</h1>
            <p className="text-muted-foreground text-sm">
              {def.triggerLabel} ·{" "}
              <span className="font-mono">{def.sourceFile}</span>
            </p>
          </div>
        </div>
        <p className="mt-3 text-muted-foreground text-sm">{def.description}</p>

        {/* Pipeline strip */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {def.steps.map((s, i) => (
            <span className="flex items-center gap-1.5" key={s}>
              <span className="rounded-md border bg-muted/40 px-2 py-1 font-mono text-muted-foreground text-xs">
                {s}
              </span>
              {i < def.steps.length - 1 ? (
                <span className="text-muted-foreground/40">›</span>
              ) : null}
            </span>
          ))}
        </div>
      </div>

      {/* Lifetime stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        <StatTile
          label="Total runs"
          sub={`${entry?.runs24h ?? 0} in 24h`}
          value={entry?.runsTotal ?? 0}
        />
        <StatTile
          label="Success rate"
          tone={successTone}
          value={entry?.successRate == null ? "—" : `${entry.successRate}%`}
        />
        <StatTile
          label="Mean duration"
          value={formatDuration(entry?.meanDurationMs ?? null)}
        />
        <StatTile
          label="Awaiting you"
          sub={`${entry?.disagreed ?? 0} disagreed`}
          tone={
            (entry?.pendingApproval ?? 0) + (entry?.disagreed ?? 0) > 0
              ? "warn"
              : "neutral"
          }
          value={(entry?.pendingApproval ?? 0) + (entry?.disagreed ?? 0)}
        />
        <StatTile
          label="Last run"
          tone={(entry?.stalled ?? 0) > 0 ? "bad" : "neutral"}
          value={entry?.lastRunAt ? relativeTime(entry.lastRunAt) : "—"}
        />
      </div>

      {/* Run history */}
      {isPrReview ? (
        <RecentRunsTable initialRuns={runs} initialTotal={total} />
      ) : (
        <div className="rounded-xl border bg-card p-8 text-center">
          <div className="font-medium text-sm">No runs yet</div>
          <p className="mt-1 text-muted-foreground text-sm">
            {def.label} is defined and wired but has not produced any durable
            runs. Runs will appear here once it emits to the audit log.
          </p>
        </div>
      )}
    </div>
  );
}
