"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  ActivitySparkline,
  RecentActivityFeed,
} from "@/components/tars/dashboard/activity-feed";
import { AttentionPanel } from "@/components/tars/dashboard/attention-panel";
import { DomainStatusStrip } from "@/components/tars/dashboard/domain-status-strip";
import { HealthKpiRow } from "@/components/tars/dashboard/health-kpi-row";
import type {
  ActivityBucket,
  DashboardOverview,
  FeedRow,
} from "@/components/tars/dashboard/types";
import { cn } from "@/lib/utils";

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) {
    return "Good morning";
  }
  if (h < 17) {
    return "Good afternoon";
  }
  return "Good evening";
}

const REFRESH_MS = 60_000;
const FEED_LIMIT = 12;

export function DashboardHome() {
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [feed, setFeed] = useState<FeedRow[]>([]);
  const [activity, setActivity] = useState<ActivityBucket[]>([]);
  const [activityHours, setActivityHours] = useState(24);
  const [loading, setLoading] = useState(true);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  const loadCore = useCallback(async () => {
    setLoading(true);
    try {
      const [overviewRes, feedRes] = await Promise.all([
        fetch("/api/tars/dashboard/overview").then((r) => r.json()),
        fetch(`/api/tars/dashboard/feed?limit=${FEED_LIMIT}`).then((r) =>
          r.json()
        ),
      ]);
      const ov = overviewRes as DashboardOverview;
      setOverview(ov);
      setGeneratedAt(ov.generatedAt ?? null);
      setFeed((feedRes as { rows: FeedRow[] }).rows ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadActivity = useCallback(async (hours: number) => {
    const res = await fetch(`/api/tars/dashboard/activity?hours=${hours}`).then(
      (r) => r.json()
    );
    setActivity((res as { buckets: ActivityBucket[] }).buckets ?? []);
  }, []);

  useEffect(() => {
    loadCore();
    const interval = setInterval(loadCore, REFRESH_MS);
    return () => clearInterval(interval);
  }, [loadCore]);

  useEffect(() => {
    loadActivity(activityHours);
  }, [activityHours, loadActivity]);

  const onWindowChange = (hours: number) => {
    setActivityHours(hours);
  };

  let generatedLabel = "live";
  if (generatedAt) {
    generatedLabel = `updated ${new Date(generatedAt).toLocaleTimeString(
      "en-ZA",
      { hour: "2-digit", minute: "2-digit" }
    )}`;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-semibold text-2xl md:text-3xl">
            {getGreeting()}, Shaun
          </h1>
          <p className="mt-1 text-muted-foreground text-sm">
            {new Date().toLocaleDateString("en-ZA", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
            <span className="ml-2 text-muted-foreground/70">
              · {generatedLabel}
            </span>
          </p>
        </div>
        <button
          aria-label="Refresh dashboard"
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-muted-foreground text-sm transition-colors hover:bg-accent hover:text-foreground"
          onClick={loadCore}
          type="button"
        >
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {overview ? (
        <>
          <AttentionPanel items={overview.attentionItems} />
          <HealthKpiRow overview={overview} />
          <DomainStatusStrip overview={overview} />
        </>
      ) : (
        <div className="space-y-4">
          <div className="h-32 animate-pulse rounded-xl border border-border bg-card" />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {["a", "b", "c", "d", "e", "f", "g", "h"].map((k) => (
              <div
                className="h-24 animate-pulse rounded-xl border border-border bg-card"
                key={k}
              />
            ))}
          </div>
        </div>
      )}

      <ActivitySparkline
        buckets={activity}
        hours={activityHours}
        loading={loading}
        onWindowChange={onWindowChange}
      />

      <RecentActivityFeed loading={loading} rows={feed} />
    </div>
  );
}
