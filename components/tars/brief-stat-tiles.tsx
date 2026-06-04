/**
 * Hero stat tiles for the /briefs page — lifts the StatTile primitive and
 * TONE_ACCENT palette from app/infra/page.tsx so the design system matches
 * exactly. Pure presentational, server-renderable.
 */

import {
  CircleHelp,
  Clock,
  GitPullRequest,
  type LucideIcon,
  Newspaper,
  TriangleAlert,
  UserCheck,
} from "lucide-react";
import type { ReactNode } from "react";

type Tone = "neutral" | "good" | "warn" | "bad";

const TONE_ACCENT: Record<Tone, string> = {
  bad: "text-red-400",
  warn: "text-amber-400",
  good: "text-[#00d4a0]",
  neutral: "text-foreground",
};

export function StatTile({
  icon: Icon,
  label,
  value,
  sub,
  tone = "neutral",
  href,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  href?: string;
}) {
  const body = (
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
  if (href) {
    return (
      <a
        className="block rounded-xl border bg-card p-4 transition-colors hover:border-[#00d4a0]/40 hover:bg-card/80"
        href={href}
      >
        {body}
      </a>
    );
  }
  return <div className="rounded-xl border bg-card p-4">{body}</div>;
}

export interface BriefHeroStats {
  latestLabel: string;
  latestSub: string;
  shaunActions: number;
  actInsights: number;
  questions: number;
  openPrs: number;
  composeLatency: string | null;
}

export function BriefHeroTiles({ stats }: { stats: BriefHeroStats }) {
  let actionsTone: Tone = "neutral";
  if (stats.shaunActions > 0) {
    actionsTone = "warn";
  }
  let actTone: Tone = "good";
  if (stats.actInsights > 0) {
    actTone = "bad";
  }
  let qTone: Tone = "neutral";
  if (stats.questions > 0) {
    qTone = "warn";
  }
  const latencyValue = stats.composeLatency ?? "—";

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <StatTile
        href="#latest-brief"
        icon={Newspaper}
        label="Latest brief"
        sub={stats.latestSub}
        value={<span className="text-xl">{stats.latestLabel}</span>}
      />
      <StatTile
        href="#next-actions"
        icon={UserCheck}
        label="Actions needing you"
        sub="owner = shaun"
        tone={actionsTone}
        value={stats.shaunActions}
      />
      <StatTile
        href="#insights"
        icon={TriangleAlert}
        label="Act-level insights"
        sub="severity = act"
        tone={actTone}
        value={stats.actInsights}
      />
      <StatTile
        href="#questions"
        icon={CircleHelp}
        label="Open questions"
        tone={qTone}
        value={stats.questions}
      />
      <StatTile
        href="#source-context"
        icon={GitPullRequest}
        label="Open PRs in scope"
        value={stats.openPrs}
      />
      <StatTile
        icon={Clock}
        label="Compose latency"
        sub="latest ready brief"
        tone="good"
        value={<span className="text-xl">{latencyValue}</span>}
      />
    </div>
  );
}
