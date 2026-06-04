import {
  AlertTriangle,
  Boxes,
  GitBranch,
  type LucideIcon,
  ScrollText,
  ServerCog,
  ShieldQuestion,
  Timer,
} from "lucide-react";
import type { ReactNode } from "react";
import { AttentionBanner } from "@/components/workflows/attention-banner";
import { RecentRunsTable } from "@/components/workflows/recent-runs-table";
import { ageFromMs } from "@/components/workflows/shared";
import { ThroughputStrip } from "@/components/workflows/throughput-strip";
import {
  QueueHealthTile,
  WorkerHealthTile,
} from "@/components/workflows/worker-health";
import { WorkflowFleetCard } from "@/components/workflows/workflow-fleet-card";
import { getWorkflowOverview } from "@/lib/tars/workflows";
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
  icon: Icon,
  label,
  value,
  sub,
  tone = "neutral",
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
        <Icon className="size-4" /> {label}
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

export default async function WorkflowsPage() {
  const overview = await getWorkflowOverview(7);
  const {
    fleet,
    recentRuns,
    attention,
    worker,
    jobs,
    throughput,
    definedCount,
    activeCount,
  } = overview;

  const runs24h = fleet.reduce((acc, f) => acc + f.runs24h, 0);
  const totalRuns = fleet.reduce((acc, f) => acc + f.runsTotal, 0);
  const awaiting =
    attention.pendingApproval.length + attention.disagreed.length;
  const stalledCount = attention.stalled.length;
  const oldestStall =
    attention.stalled.length > 0 ? ageFromMs(attention.stalled[0].ageMs) : null;

  let workerValue = "Offline";
  let workerTone: Tone = "bad";
  let workerSub = "executor not reporting";
  if (worker.online && worker.lastSeenMs !== null) {
    workerValue = "Online";
    workerTone = "good";
    workerSub = `seen ${ageFromMs(worker.lastSeenMs)} ago`;
  }

  const jobFailTone: Tone = jobs.failureRate > 5 ? "warn" : "good";

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="flex items-center gap-2 font-semibold text-xl">
          <GitBranch className="size-5 text-[#00d4a0]" /> Workflows
        </h1>
        <p className="text-muted-foreground text-sm">
          TARS&apos;s own durable WDK workflows — fleet health, recent runs, and
          the human gates that need you.
        </p>
      </div>

      {/* Hero tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile
          icon={GitBranch}
          label="Defined"
          sub={`${activeCount} active`}
          value={definedCount}
        />
        <StatTile
          icon={ScrollText}
          label="Runs · 24h"
          tone="neutral"
          value={runs24h}
        />
        <StatTile
          icon={ShieldQuestion}
          label="Awaiting you"
          sub={`${attention.pendingApproval.length} approve · ${attention.disagreed.length} adjudicate`}
          tone={awaiting > 0 ? "warn" : "neutral"}
          value={awaiting}
        />
        <StatTile
          icon={AlertTriangle}
          label="Stalled"
          sub={oldestStall ? `oldest ${oldestStall}` : "none"}
          tone={stalledCount > 0 ? "bad" : "good"}
          value={stalledCount}
        />
        <StatTile
          icon={ServerCog}
          label="Worker"
          sub={workerSub}
          tone={workerTone}
          value={workerValue}
        />
        <StatTile
          icon={Boxes}
          label="Job fail rate"
          sub={`${jobs.failed}/${jobs.failed + (jobs.byStatus.done ?? 0)} jobs`}
          tone={jobFailTone}
          value={`${jobs.failureRate}%`}
        />
      </div>

      {/* Attention banner */}
      <AttentionBanner
        disagreed={attention.disagreed}
        pendingApproval={attention.pendingApproval}
        stalled={attention.stalled}
      />

      {/* Fleet */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-lg">Workflow fleet</h2>
          <span className="text-muted-foreground text-sm">
            {activeCount} of {definedCount} active
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {fleet.map((wf) => (
            <WorkflowFleetCard key={wf.key} wf={wf} />
          ))}
        </div>
      </section>

      {/* Recent runs */}
      <RecentRunsTable initialRuns={recentRuns} initialTotal={totalRuns} />

      {/* Throughput */}
      <ThroughputStrip initial={throughput} />

      {/* Worker + queue health */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 font-semibold text-lg">
          <Timer className="size-4 text-[#00d4a0]" /> Worker &amp; queue health
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <WorkerHealthTile worker={worker} />
          <QueueHealthTile jobs={jobs} />
        </div>
      </section>
    </div>
  );
}
