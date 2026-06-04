"use client";

import {
  Activity,
  ArrowRight,
  Cloud,
  type LucideIcon,
  Network,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type {
  AwsDomain,
  DashboardOverview,
  GraphDomain,
  PrDomain,
  TemporalDomain,
} from "./types";
import { money } from "./types";

type Dot = "good" | "warn" | "bad" | "muted";

const DOT_CLASS: Record<Dot, string> = {
  good: "bg-[#00d4a0]",
  warn: "bg-amber-500",
  bad: "bg-red-500",
  muted: "bg-muted-foreground/50",
};

function DomainCard({
  icon: Icon,
  title,
  dot,
  href,
  children,
}: {
  icon: LucideIcon;
  title: string;
  dot: Dot;
  href: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn("size-2.5 rounded-full", DOT_CLASS[dot])} />
          <Icon className="size-4 text-muted-foreground" />
          <span className="font-medium text-sm">{title}</span>
        </div>
        <Link
          className="inline-flex items-center gap-0.5 text-[#00d4a0] text-xs hover:underline"
          href={href}
        >
          View
          <ArrowRight className="size-3" />
        </Link>
      </div>
      <div className="mt-3 flex-1">{children}</div>
    </div>
  );
}

function StatPair({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="font-medium text-sm tabular-nums">{value}</div>
    </div>
  );
}

/** A horizontal split bar from labeled segments, each with a color + count. */
function SplitBar({
  segments,
}: {
  segments: { key: string; count: number; color: string }[];
}) {
  const total = segments.reduce((n, s) => n + s.count, 0) || 1;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted/40">
      {segments
        .filter((s) => s.count > 0)
        .map((s) => (
          <div
            className={s.color}
            key={s.key}
            style={{ width: `${(s.count / total) * 100}%` }}
            title={`${s.key}: ${s.count}`}
          />
        ))}
    </div>
  );
}

function AwsCard({ aws }: { aws: AwsDomain }) {
  let dot: Dot = "good";
  if (!aws.available) {
    dot = "muted";
  } else if (aws.securityFiring > 0 || aws.degraded > 0) {
    dot = "bad";
  } else if (aws.totalFiring > 0) {
    dot = "warn";
  }
  const trend = aws.accounts.flatMap((a) => a.costTrend);
  const merged = new Map<string, number>();
  for (const p of trend) {
    merged.set(p.date, (merged.get(p.date) ?? 0) + p.amount);
  }
  const series = [...merged.entries()]
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-14);
  const maxAmt = Math.max(1, ...series.map((p) => p.amount));

  return (
    <DomainCard dot={dot} href="/infra" icon={Cloud} title="AWS Ops">
      {aws.available ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <StatPair
              label="Services"
              value={`${aws.healthy}/${aws.totalSvc}`}
            />
            <StatPair label="Alarms" value={aws.totalFiring} />
            <StatPair
              label="Spend/day"
              value={money(aws.costYesterday, aws.currency, true)}
            />
          </div>
          {series.length > 0 ? (
            <div className="flex h-10 items-end justify-end gap-px">
              {series.map((p) => (
                <div
                  className="w-1.5 rounded-t bg-[#00d4a0]/70"
                  key={p.date}
                  style={{
                    height: `${Math.max(6, (p.amount / maxAmt) * 100)}%`,
                  }}
                  title={`${p.date}: ${money(p.amount, aws.currency, true)}`}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">tars-graph unreachable</p>
      )}
    </DomainCard>
  );
}

function TemporalCard({ temporal }: { temporal: TemporalDomain }) {
  let dot: Dot = "good";
  if (!temporal.available) {
    dot = "muted";
  } else if (temporal.running > 0) {
    dot = "warn";
  }
  return (
    <DomainCard dot={dot} href="/temporal" icon={Workflow} title="Temporal">
      {temporal.available ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <StatPair label="Running" value={temporal.running} />
            <StatPair label="Completed" value={temporal.completed} />
            <StatPair label="Failed" value={temporal.failed} />
          </div>
          <SplitBar
            segments={[
              {
                key: "completed",
                count: temporal.completed,
                color: "bg-[#00d4a0]/70",
              },
              {
                key: "running",
                count: temporal.running,
                color: "bg-sky-500/70",
              },
              { key: "failed", count: temporal.failed, color: "bg-red-500/60" },
            ]}
          />
          <p className="truncate font-mono text-muted-foreground text-xs">
            {temporal.namespace}
          </p>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">tars-graph unreachable</p>
      )}
    </DomainCard>
  );
}

function PrCard({ pr }: { pr: PrDomain }) {
  let dot: Dot = "good";
  if (pr.errored > 0) {
    dot = "bad";
  } else if (pr.pendingApproval > 0 || pr.disagreed > 0) {
    dot = "warn";
  }
  return (
    <DomainCard dot={dot} href="/pr-runs" icon={Activity} title="PR Pipeline">
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <StatPair label="In flight" value={pr.inFlight} />
          <StatPair label="Pending" value={pr.pendingApproval} />
          <StatPair label="Disagreed" value={pr.disagreed} />
        </div>
        <SplitBar
          segments={[
            {
              key: "pending",
              count: pr.pendingApproval,
              color: "bg-sky-500/70",
            },
            {
              key: "disagreed",
              count: pr.disagreed,
              color: "bg-purple-500/70",
            },
            { key: "in flight", count: pr.inFlight, color: "bg-amber-500/70" },
            { key: "errored", count: pr.errored, color: "bg-red-500/60" },
          ]}
        />
        <p className="text-muted-foreground text-xs">
          {pr.total} runs over {pr.windowDays}d · {pr.disagreementRate}%
          disagreement
        </p>
      </div>
    </DomainCard>
  );
}

function GraphCard({ graph }: { graph: GraphDomain }) {
  const dot: Dot = graph.available ? "good" : "muted";
  const topNodes = graph.nodes
    .slice()
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);
  const maxNode = Math.max(1, ...topNodes.map((n) => n.count));
  return (
    <DomainCard
      dot={dot}
      href="/knowledge"
      icon={Network}
      title="Knowledge Graph"
    >
      {graph.available ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <StatPair
              label="Nodes"
              value={graph.totalNodes.toLocaleString("en-US")}
            />
            <StatPair
              label="Edges"
              value={graph.totalEdges.toLocaleString("en-US")}
            />
          </div>
          <div className="space-y-1">
            {topNodes.map((n) => (
              <div className="flex items-center gap-2" key={n.type}>
                <span className="w-20 shrink-0 truncate text-muted-foreground text-xs">
                  {n.type}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted/40">
                  <div
                    className="h-full rounded-full bg-[#00d4a0]/70"
                    style={{ width: `${(n.count / maxNode) * 100}%` }}
                  />
                </div>
                <span className="w-12 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
                  {n.count.toLocaleString("en-US")}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">tars-graph unreachable</p>
      )}
    </DomainCard>
  );
}

export function DomainStatusStrip({
  overview,
}: {
  overview: DashboardOverview;
}) {
  const { pr, aws, temporal, graph } = overview.domains;
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-2 font-semibold text-sm">
        Domain status
        <span className="font-normal text-muted-foreground">
          · AWS · Temporal · PR pipeline · graph
        </span>
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <AwsCard aws={aws} />
        <TemporalCard temporal={temporal} />
        <PrCard pr={pr} />
        <GraphCard graph={graph} />
      </div>
    </section>
  );
}
