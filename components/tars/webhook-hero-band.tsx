"use client";

import {
  Bot,
  GitBranch,
  type LucideIcon,
  Radio,
  Webhook,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { WebhookStats } from "@/lib/tars/webhooks-stats";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "good" | "warn" | "bad";

const TONE_ACCENT: Record<Tone, string> = {
  bad: "text-red-400",
  warn: "text-amber-400",
  good: "text-[#00d4a0]",
  neutral: "text-foreground",
};

export interface WebhookFilter {
  repo?: string;
  event?: string;
  action?: string;
  sender?: string;
  outcome?: string;
  since24h?: boolean;
}

interface HeroTile {
  key: string;
  icon: LucideIcon;
  label: string;
  value: string;
  sub: string;
  tone: Tone;
  filter: WebhookFilter | null;
}

function buildTiles(stats: WebhookStats): HeroTile[] {
  const topRepo = stats.byRepo[0];
  const topBot = stats.senders.find((s) => s.isBot);
  const enabledRepos = stats.byRepo.length;
  const pct =
    stats.actionRate.totalPr > 0
      ? Math.round(
          (stats.actionRate.triggered / stats.actionRate.totalPr) * 100
        )
      : 0;

  return [
    {
      key: "today",
      icon: Webhook,
      label: "Events today",
      value: stats.todayCount.toLocaleString(),
      sub: `${stats.last7dCount.toLocaleString()} in last 7d`,
      tone: "neutral",
      filter: { since24h: true },
    },
    {
      key: "action",
      icon: Zap,
      label: "Action rate (PRs → runs)",
      value: `${stats.actionRate.triggered}/${stats.actionRate.totalPr}`,
      sub: `${pct}% of pull_request events triggered a review`,
      tone: pct >= 40 ? "good" : "warn",
      filter: { event: "pull_request" },
    },
    {
      key: "ingress",
      icon: Radio,
      label: "Active sources (7d)",
      value: enabledRepos.toLocaleString(),
      sub: "repos delivering events",
      tone: "neutral",
      filter: null,
    },
    {
      key: "busiest",
      icon: GitBranch,
      label: "Busiest source (7d)",
      value: topRepo ? topRepo.count.toLocaleString() : "0",
      sub: topRepo ? topRepo.repoKey : "no deliveries",
      tone: "neutral",
      filter: topRepo ? { repo: topRepo.repoKey } : null,
    },
    {
      key: "bot",
      icon: Bot,
      label: "Bot traffic",
      value: topBot ? topBot.count.toLocaleString() : "0",
      sub: topBot ? topBot.login : "no bot senders",
      tone: topBot ? "warn" : "neutral",
      filter: topBot ? { sender: topBot.login } : null,
    },
  ];
}

function Sparkline({ stats }: { stats: WebhookStats }) {
  const max = Math.max(1, ...stats.hourly.map((p) => p.count));
  const total = stats.hourly.reduce((acc, p) => acc + p.count, 0);
  const isWeek = stats.windowHours >= 168;
  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 text-muted-foreground text-xs">
        {total.toLocaleString()} events · {isWeek ? "by day" : "by hour"}
      </div>
      {stats.hourly.length > 0 ? (
        <div className="flex h-16 flex-1 items-end gap-px">
          {stats.hourly.map((p) => {
            const labelDate = new Date(p.hour);
            const when = isWeek
              ? labelDate.toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })
              : `${labelDate.getHours()}:00`;
            return (
              <div
                className="min-w-[3px] flex-1 rounded-t bg-[#00d4a0]/70"
                key={p.hour}
                style={{ height: `${Math.max(6, (p.count / max) * 100)}%` }}
                title={`${when}: ${p.count} events`}
              />
            );
          })}
        </div>
      ) : (
        <div className="flex flex-1 items-center text-muted-foreground text-xs">
          No events in window
        </div>
      )}
    </div>
  );
}

export function WebhookHeroBand({
  initialStats,
  onFilter,
}: {
  initialStats: WebhookStats;
  onFilter: (filter: WebhookFilter) => void;
}) {
  const [stats, setStats] = useState(initialStats);
  const [windowHours, setWindowHours] = useState(initialStats.windowHours);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setStats(initialStats);
  }, [initialStats]);

  async function changeWindow(next: number) {
    if (next === windowHours) {
      return;
    }
    setWindowHours(next);
    setLoading(true);
    try {
      const res = await fetch(`/api/tars/webhooks/stats?window=${next}`);
      const data = (await res.json()) as WebhookStats;
      setStats(data);
    } finally {
      setLoading(false);
    }
  }

  const tiles = buildTiles(stats);

  return (
    <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((t) => {
          const Icon = t.icon;
          const clickable = t.filter !== null;
          return (
            <button
              className={cn(
                "rounded-xl border bg-card p-4 text-left transition-colors",
                clickable
                  ? "cursor-pointer hover:border-[#00d4a0]/40 hover:bg-accent/40"
                  : "cursor-default"
              )}
              disabled={!clickable}
              key={t.key}
              onClick={() => {
                if (t.filter) {
                  onFilter(t.filter);
                }
              }}
              type="button"
            >
              <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
                <Icon className="size-4" /> {t.label}
              </div>
              <div
                className={cn(
                  "mt-1 font-semibold text-2xl tabular-nums",
                  TONE_ACCENT[t.tone]
                )}
              >
                {t.value}
              </div>
              <div className="truncate text-muted-foreground text-xs">
                {t.sub}
              </div>
            </button>
          );
        })}
      </div>

      <div
        className={cn(
          "rounded-xl border bg-card p-4 transition-opacity",
          loading && "opacity-60"
        )}
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-muted-foreground text-xs uppercase tracking-wide">
            Volume
          </span>
          <div className="flex gap-1 rounded-md border p-0.5">
            {[
              { h: 24, label: "24h" },
              { h: 168, label: "7d" },
            ].map((opt) => (
              <button
                className={cn(
                  "rounded px-2 py-0.5 text-xs transition-colors",
                  windowHours === opt.h
                    ? "bg-[#00d4a0]/15 text-[#00d4a0]"
                    : "text-muted-foreground hover:text-foreground"
                )}
                key={opt.h}
                onClick={() => changeWindow(opt.h)}
                type="button"
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <Sparkline stats={stats} />
      </div>
    </div>
  );
}
