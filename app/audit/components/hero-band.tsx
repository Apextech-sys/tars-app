"use client";

import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  Database,
  GitPullRequest,
  Inbox,
  type LucideIcon,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import type { AuditSummary } from "../actions";

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
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
        <Icon className="size-4" /> {label}
      </div>
      <div
        className={`mt-1 font-semibold text-2xl tabular-nums ${TONE_ACCENT[tone]}`}
      >
        {value}
      </div>
      {sub ? <div className="text-muted-foreground text-xs">{sub}</div> : null}
    </>
  );
  if (onClick) {
    return (
      <button
        className="rounded-xl border bg-card p-4 text-left transition-colors hover:border-[#00d4a0]/40 hover:bg-accent/40"
        onClick={onClick}
        type="button"
      >
        {inner}
      </button>
    );
  }
  return <div className="rounded-xl border bg-card p-4">{inner}</div>;
}

const NUM = new Intl.NumberFormat("en-US");

export function HeroBand({
  summary,
  onFilterFailures,
  onFilterErrors,
}: {
  summary: AuditSummary;
  onFilterFailures: () => void;
  onFilterErrors: () => void;
}) {
  const failTone: Tone = summary.failures24h > 0 ? "bad" : "good";
  const errTone: Tone = summary.errorsAllTime > 0 ? "warn" : "neutral";

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <StatTile
        icon={Activity}
        label="Actions · 24h"
        sub="logged in last 24h"
        value={NUM.format(summary.count24h)}
      />
      <StatTile
        icon={summary.failures24h > 0 ? AlertOctagon : Activity}
        label="Failures · 24h"
        onClick={onFilterFailures}
        sub={summary.failures24h > 0 ? "needs attention" : "all clear"}
        tone={failTone}
        value={NUM.format(summary.failures24h)}
      />
      <StatTile
        icon={GitPullRequest}
        label="PR runs · 24h"
        sub={`${summary.runs24h} of recent runs`}
        value={NUM.format(summary.runs24h)}
      />
      <StatTile
        icon={Database}
        label="Total actions"
        sub="in retention window"
        value={NUM.format(summary.total)}
      />
      <StatTile
        icon={XCircle}
        label="Errors logged"
        onClick={onFilterErrors}
        sub="across the window"
        tone={errTone}
        value={NUM.format(summary.errorsAllTime)}
      />
      <StatTile
        icon={Inbox}
        label="Awaiting your call"
        sub="pending + disagreed → inbox"
        tone={summary.pendingDisagreedRuns > 0 ? "warn" : "neutral"}
        value={
          <a className="hover:underline" href="/inbox" title="Open the inbox">
            {NUM.format(summary.pendingDisagreedRuns)}
          </a>
        }
      />
    </div>
  );
}

export function StatusBanner({ summary }: { summary: AuditSummary }) {
  const failing = summary.failures24h > 0;
  const attention =
    summary.errorsAllTime > 0 || summary.pendingDisagreedRuns > 0;

  let cls = "border-[#00d4a0]/30 bg-[#00d4a0]/10 text-[#00d4a0]";
  let Icon: LucideIcon = Activity;
  let headline = "All systems nominal";
  if (failing) {
    cls = "border-red-500/30 bg-red-500/10 text-red-400";
    Icon = AlertOctagon;
    headline = `${summary.failures24h} failure${summary.failures24h === 1 ? "" : "s"} in the last 24h`;
  } else if (attention) {
    cls = "border-amber-500/30 bg-amber-500/10 text-amber-400";
    Icon = AlertTriangle;
    headline = "Attention required";
  }

  const lastSeen = summary.lastActionAt
    ? relSince(summary.lastActionAt)
    : "no activity";

  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border px-4 py-3 text-sm ${cls}`}
    >
      <span className="flex items-center gap-2 font-medium">
        <Icon className="size-4" /> {headline}
      </span>
      <span className="text-muted-foreground">last action {lastSeen}</span>
      {summary.pendingDisagreedRuns > 0 ? (
        <a
          className="ml-auto text-muted-foreground underline-offset-2 hover:underline"
          href="/inbox"
        >
          {summary.pendingDisagreedRuns} awaiting adjudication →
        </a>
      ) : null}
    </div>
  );
}

function relSince(iso: string): string {
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
  return `${Math.floor(h / 24)}d ago`;
}
