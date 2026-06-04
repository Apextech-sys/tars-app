"use client";

import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Hourglass,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Wrench,
  Zap,
} from "lucide-react";
import type { ComponentType } from "react";
import type { InboxSummary } from "@/app/inbox/actions";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "good" | "warn" | "bad";

const TONE_ACCENT: Record<Tone, string> = {
  bad: "text-red-400",
  good: "text-[#00d4a0]",
  neutral: "text-foreground",
  warn: "text-amber-400",
};

function formatAge(ms: number | null): string {
  if (ms === null) {
    return "—";
  }
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) {
    return "<1m";
  }
  if (mins < 60) {
    return `${mins}m`;
  }
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) {
    return `${hrs}h ${mins % 60}m`;
  }
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}

interface TileDef {
  icon: ComponentType<{ className?: string }>;
  jump: string | null;
  label: string;
  sub: string;
  tone: Tone;
  value: string;
}

function HeroTile({
  def,
  onJump,
}: {
  def: TileDef;
  onJump: (target: string) => void;
}) {
  const { icon: Icon } = def;
  const clickable = def.jump !== null;
  return (
    <button
      className={cn(
        "rounded-xl border bg-card p-4 text-left transition-colors",
        clickable && "hover:border-[#00d4a0]/40 hover:bg-accent/40"
      )}
      disabled={!clickable}
      onClick={() => def.jump && onJump(def.jump)}
      type="button"
    >
      <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
        <Icon className="size-4" /> {def.label}
      </div>
      <div
        className={cn(
          "mt-1 font-semibold text-2xl tabular-nums",
          TONE_ACCENT[def.tone]
        )}
      >
        {def.value}
      </div>
      <div className="text-muted-foreground text-xs">{def.sub}</div>
    </button>
  );
}

interface BannerState {
  className: string;
  icon: ComponentType<{ className?: string }>;
  text: string;
}

function resolveBanner(summary: InboxSummary): BannerState {
  const stalledOrErrored = summary.stalled + summary.errored;
  const decisionBacklog = summary.pendingApproval + summary.disagreed;
  if (summary.criticalFindings > 0 || stalledOrErrored > 0) {
    return {
      className: "border-red-500/30 bg-red-500/10 text-red-400",
      icon: AlertOctagon,
      text: "Urgent attention required",
    };
  }
  if (decisionBacklog > 0) {
    return {
      className: "border-amber-500/30 bg-amber-500/10 text-amber-400",
      icon: AlertTriangle,
      text: "Decisions waiting on you",
    };
  }
  return {
    className: "border-[#00d4a0]/30 bg-[#00d4a0]/10 text-[#00d4a0]",
    icon: CheckCircle2,
    text: "Inbox clear — nothing waiting on you",
  };
}

function toneFor(value: number, present: Tone, absent: Tone): Tone {
  return value > 0 ? present : absent;
}

function buildTiles(summary: InboxSummary): TileDef[] {
  const stalledOrErrored = summary.stalled + summary.errored;
  const oldStale =
    summary.oldestWaitingMs !== null && summary.oldestWaitingMs > 3_600_000;
  return [
    {
      icon: ShieldCheck,
      jump: "approvals",
      label: "Awaiting approval",
      sub: "PR reviews agreed",
      tone: toneFor(summary.pendingApproval, "warn", "neutral"),
      value: String(summary.pendingApproval),
    },
    {
      icon: Scale,
      jump: "disagreements",
      label: "Need adjudication",
      sub: "Codex vs Claude split",
      tone: toneFor(summary.disagreed, "warn", "neutral"),
      value: String(summary.disagreed),
    },
    {
      icon: ShieldAlert,
      jump: "approvals",
      label: "Critical findings",
      sub: "in pending approvals",
      tone: toneFor(summary.criticalFindings, "bad", "good"),
      value: String(summary.criticalFindings),
    },
    {
      icon: AlertOctagon,
      jump: "health",
      label: "Stalled / errored",
      sub: `${summary.stalled} stalled · ${summary.errored} error`,
      tone: toneFor(stalledOrErrored, "bad", "good"),
      value: String(stalledOrErrored),
    },
    {
      icon: Zap,
      jump: "health",
      label: "Worker fails 7d",
      sub: "jobs failed",
      tone: toneFor(summary.failedJobs7d, "warn", "neutral"),
      value: String(summary.failedJobs7d),
    },
    {
      icon: Hourglass,
      jump: "decision",
      label: "Oldest waiting",
      sub: "longest unread decision",
      tone: oldStale ? "bad" : "neutral",
      value: formatAge(summary.oldestWaitingMs),
    },
  ];
}

export function InboxHero({
  onJump,
  summary,
}: {
  onJump: (target: string) => void;
  summary: InboxSummary;
}) {
  const decisionBacklog = summary.pendingApproval + summary.disagreed;
  const workerAlive =
    summary.workerLastSeenMs !== null && summary.workerLastSeenMs < 120_000;
  const banner = resolveBanner(summary);
  const BannerIcon = banner.icon;
  const tiles = buildTiles(summary);

  return (
    <div className="space-y-4">
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border px-4 py-3 text-sm",
          banner.className
        )}
      >
        <span className="flex items-center gap-2 font-medium">
          <BannerIcon className="size-4" /> {banner.text}
        </span>
        {summary.criticalFindings > 0 ? (
          <span>
            · {summary.criticalFindings} critical finding
            {summary.criticalFindings === 1 ? "" : "s"} pending
          </span>
        ) : null}
        {summary.stalled > 0 ? (
          <span>
            · {summary.stalled} run{summary.stalled === 1 ? "" : "s"} stalled
          </span>
        ) : null}
        {decisionBacklog > 0 ? (
          <span>
            · {decisionBacklog} decision{decisionBacklog === 1 ? "" : "s"}{" "}
            queued
          </span>
        ) : null}
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs">
          {workerAlive ? (
            <Wrench className="size-3.5" />
          ) : (
            <Clock className="size-3.5" />
          )}
          {summary.workerId ?? "review worker"} ·{" "}
          {workerAlive
            ? "online"
            : `last seen ${formatAge(summary.workerLastSeenMs)} ago`}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((def) => (
          <HeroTile def={def} key={def.label} onJump={onJump} />
        ))}
      </div>
    </div>
  );
}
