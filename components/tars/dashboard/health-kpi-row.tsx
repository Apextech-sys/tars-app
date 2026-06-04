"use client";

import {
  Bot,
  type LucideIcon,
  Network,
  ShieldAlert,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Workflow,
  Zap,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { DashboardOverview } from "./types";
import { money } from "./types";

type Tone = "neutral" | "good" | "warn" | "bad";

const TONE_ACCENT: Record<Tone, string> = {
  bad: "text-red-400",
  warn: "text-amber-400",
  good: "text-[#00d4a0]",
  neutral: "text-foreground",
};

interface Kpi {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  sub: ReactNode;
  tone: Tone;
  href: string;
}

function KpiTile({ kpi }: { kpi: Kpi }) {
  const Icon = kpi.icon;
  return (
    <Link
      className="group flex min-h-[44px] flex-col rounded-xl border border-border bg-card p-4 transition-colors hover:border-[#00d4a0]/40 hover:bg-accent/30"
      href={kpi.href}
    >
      <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
        <Icon className="size-4" />
        {kpi.label}
      </div>
      <div
        className={cn(
          "mt-1 font-semibold text-2xl tabular-nums",
          TONE_ACCENT[kpi.tone]
        )}
      >
        {kpi.value}
      </div>
      <div className="text-muted-foreground text-xs">{kpi.sub}</div>
    </Link>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: breadth of independent branches/panels in one cohesive view-builder, not tangled control flow; splitting would scatter co-located UI logic
function buildKpis(o: DashboardOverview): Kpi[] {
  const { domains, attentionItems, attentionCounts, criticalFindings } = o;
  const { pr, aws, temporal, graph, workers } = domains;

  const attentionTotal = attentionItems.length;
  let attentionTone: Tone = "good";
  if (attentionCounts.blocker > 0) {
    attentionTone = "bad";
  } else if (attentionCounts.warn > 0) {
    attentionTone = "warn";
  }

  let errorTone: Tone = "good";
  if (pr.errorRate >= 15) {
    errorTone = "bad";
  } else if (pr.errorRate >= 5) {
    errorTone = "warn";
  }

  let alarmTone: Tone = "good";
  if (aws.securityFiring > 0 || aws.degraded > 0) {
    alarmTone = "bad";
  } else if (aws.totalFiring > 0) {
    alarmTone = "warn";
  }

  let workerTone: Tone = "neutral";
  if (workers.red > 0 || workers.total === 0) {
    workerTone = "bad";
  } else if (workers.amber > 0) {
    workerTone = "warn";
  } else if (workers.green > 0) {
    workerTone = "good";
  }

  const TrendIcon = aws.costDelta >= 0 ? TrendingUp : TrendingDown;
  const trendColor = aws.costDelta >= 0 ? "text-amber-400" : "text-[#00d4a0]";

  const attentionSub =
    criticalFindings > 0
      ? `${criticalFindings} critical · ${attentionCounts.blocker} blockers`
      : `${attentionCounts.blocker} blockers · ${attentionCounts.warn} warn`;

  const alarmSub =
    aws.securityFiring > 0
      ? `${aws.securityFiring} security · rest autoscaling`
      : "mostly autoscaling noise";

  const workerSub = workers.total > 0 ? "heartbeat live" : "no heartbeat";

  return [
    {
      icon: ShieldAlert,
      label: "Needs attention",
      value: attentionTotal,
      sub: attentionSub,
      tone: attentionTone,
      href: "/inbox",
    },
    {
      icon: ShieldCheck,
      label: "Pending approval",
      value: pr.pendingApproval,
      sub: pr.pendingApproval > 0 ? "awaiting your call" : "nothing waiting",
      tone: pr.pendingApproval > 0 ? "warn" : "good",
      href: "/pr-runs?status=pending-approval",
    },
    {
      icon: ShieldAlert,
      label: "Firing alarms",
      value: aws.available ? aws.totalFiring : "—",
      sub: aws.available ? alarmSub : "AWS unavailable",
      tone: aws.available ? alarmTone : "neutral",
      href: "/infra",
    },
    {
      icon: Workflow,
      label: "Temporal workflows",
      value: temporal.available ? temporal.running : "—",
      sub: temporal.available
        ? `running · ${temporal.failed} failed (lifetime)`
        : "Temporal unavailable",
      tone: temporal.available && temporal.running > 0 ? "warn" : "neutral",
      href: "/temporal",
    },
    {
      icon: aws.costDelta >= 0 ? TrendingUp : TrendingDown,
      label: "AWS spend / day",
      value: aws.available ? money(aws.costYesterday, aws.currency, true) : "—",
      sub: aws.available ? (
        <span className="inline-flex items-center gap-1">
          <TrendIcon className={cn("size-3", trendColor)} />
          {money(Math.abs(aws.costDelta), aws.currency, true)} vs prior
        </span>
      ) : (
        "AWS unavailable"
      ),
      tone: "neutral",
      href: "/infra",
    },
    {
      icon: Zap,
      label: "PR error rate (7d)",
      value: pr.available ? `${pr.errorRate}%` : "—",
      sub: pr.available ? `over ${pr.total} runs` : "no data",
      tone: pr.available ? errorTone : "neutral",
      href: "/pr-runs",
    },
    {
      icon: Network,
      label: "Knowledge graph",
      value: graph.available ? graph.totalNodes.toLocaleString("en-US") : "—",
      sub: graph.available
        ? `${graph.totalEdges.toLocaleString("en-US")} edges`
        : "graph unavailable",
      tone: "neutral",
      href: "/knowledge",
    },
    {
      icon: Bot,
      label: "Workers online",
      value: `${workers.green}/${workers.total}`,
      sub: workerSub,
      tone: workerTone,
      href: "/pr-runs",
    },
  ];
}

export function HealthKpiRow({ overview }: { overview: DashboardOverview }) {
  const kpis = buildKpis(overview);
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {kpis.map((kpi) => (
        <KpiTile key={kpi.label} kpi={kpi} />
      ))}
    </div>
  );
}
