import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  prReviewRuns,
  repoSettings,
  webhookEvents,
} from "@/lib/db/tars-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DayBucket {
  day: string;
  count: number;
}

interface StatusCount {
  status: string;
  count: number;
}

export interface RepoRow {
  repoKey: string;
  owner: string;
  repo: string;
  webhookEnabled: boolean;
  autoFix: boolean;
  hookInstalled: boolean;
  notes: string | null;
  updatedAt: string | null;
  deliveryCount: number;
  lastDeliveryAt: string | null;
  dailyBuckets: DayBucket[];
  reviewRunCount: number;
  statusCounts: StatusCount[];
}

/**
 * Backs the projects registry / review-controls section. repo_settings is the
 * DB source of truth (the legacy projects.yaml is ENOENT in prod), joined with
 * webhook_events activity and pr_review_runs status rollups so the FE can show
 * delivery sparklines + review-engine context without N follow-up fetches.
 */
export async function GET(): Promise<NextResponse> {
  const settings = await db
    .select()
    .from(repoSettings)
    .orderBy(repoSettings.repoKey);

  const webhookAgg = await db
    .select({
      repoKey: webhookEvents.repoKey,
      count: sql<number>`count(*)::int`,
      last: sql<string | null>`max(${webhookEvents.createdAt})`,
    })
    .from(webhookEvents)
    .groupBy(webhookEvents.repoKey);

  const buckets = await db
    .select({
      repoKey: webhookEvents.repoKey,
      day: sql<string>`to_char(date_trunc('day', ${webhookEvents.createdAt}), 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
    })
    .from(webhookEvents)
    .where(sql`${webhookEvents.createdAt} > now() - interval '7 days'`)
    .groupBy(
      webhookEvents.repoKey,
      sql`date_trunc('day', ${webhookEvents.createdAt})`
    );

  const runAgg = await db
    .select({
      owner: prReviewRuns.owner,
      repo: prReviewRuns.repo,
      status: prReviewRuns.status,
      count: sql<number>`count(*)::int`,
    })
    .from(prReviewRuns)
    .groupBy(prReviewRuns.owner, prReviewRuns.repo, prReviewRuns.status);

  const webhookMap = new Map<string, { count: number; last: string | null }>();
  for (const w of webhookAgg) {
    webhookMap.set(w.repoKey, { count: w.count, last: w.last });
  }

  const bucketMap = new Map<string, DayBucket[]>();
  for (const b of buckets) {
    const list = bucketMap.get(b.repoKey) ?? [];
    list.push({ day: b.day, count: b.count });
    bucketMap.set(b.repoKey, list);
  }
  for (const list of bucketMap.values()) {
    list.sort((a, b) => a.day.localeCompare(b.day));
  }

  const runMap = new Map<string, StatusCount[]>();
  for (const r of runAgg) {
    const key = `${r.owner}/${r.repo}`;
    const list = runMap.get(key) ?? [];
    list.push({ status: r.status, count: r.count });
    runMap.set(key, list);
  }

  const rows: RepoRow[] = settings.map((s) => {
    const wh = webhookMap.get(s.repoKey);
    const statusCounts = runMap.get(s.repoKey) ?? [];
    const reviewRunCount = statusCounts.reduce((n, c) => n + c.count, 0);
    return {
      repoKey: s.repoKey,
      owner: s.owner,
      repo: s.repo,
      webhookEnabled: s.webhookEnabled,
      autoFix: s.autoFix,
      hookInstalled: s.githubHookId !== null,
      notes: s.notes,
      updatedAt: s.updatedAt?.toISOString() ?? null,
      deliveryCount: wh?.count ?? 0,
      lastDeliveryAt: wh?.last ?? null,
      dailyBuckets: bucketMap.get(s.repoKey) ?? [],
      reviewRunCount,
      statusCounts: statusCounts.sort((a, b) => b.count - a.count),
    };
  });

  return NextResponse.json({ repos: rows });
}
