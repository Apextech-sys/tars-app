/**
 * Server-side aggregate queries for the /webhooks ops console.
 *
 * All numbers reflect the WHOLE webhook_events table (not a single page),
 * so the hero band + breakdown strips never lie about volume. Pure DB
 * (drizzle over @/lib/db) — no GitHub-side calls; ingress "health" is the
 * honest in-DB "last event seen" signal per repo.
 *
 * Data-honesty note: webhook_events only stores ACCEPTED GitHub deliveries
 * (signature-failed 401s are rejected before insert), so there is no true
 * success/fail rate — the real metric is the ACTION RATE: how many
 * pull_request deliveries actually triggered a review run.
 */

import { desc, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { repoSettings, webhookEvents } from "@/lib/db/tars-schema";

export interface WebhookStats {
  todayCount: number;
  last7dCount: number;
  totalCount: number;
  actionRate: { triggered: number; totalPr: number };
  byType: { eventType: string; count: number }[];
  byRepo: {
    repoKey: string;
    count: number;
    triggered: number;
    lastSeen: string | null;
  }[];
  senders: { login: string; count: number; isBot: boolean }[];
  topActions: { action: string; count: number }[];
  hourly: { hour: string; count: number }[];
  windowHours: number;
}

export interface IngressRepo {
  repoKey: string;
  owner: string;
  repo: string;
  webhookEnabled: boolean;
  autoFix: boolean;
  githubHookId: number | null;
  notes: string | null;
  count7d: number;
  triggered7d: number;
  lastEventAt: string | null;
}

function isBotLogin(login: string): boolean {
  return login.endsWith("[bot]");
}

function toIso(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }
  return new Date(value).toISOString();
}

const COUNT = sql<number>`count(*)`.mapWith(Number);
const TODAY_COUNT = sql<number>`
  count(*) filter (where ${webhookEvents.createdAt} > now() - interval '24 hours')
`.mapWith(Number);
const LAST7D_COUNT = sql<number>`
  count(*) filter (where ${webhookEvents.createdAt} > now() - interval '7 days')
`.mapWith(Number);
const TRIGGERED_COUNT = sql<number>`
  count(${webhookEvents.triggeredRun})
`.mapWith(Number);
const LAST_SEEN = sql<string | null>`max(${webhookEvents.createdAt})`;

/**
 * Full-table aggregate stats. `windowHours` controls the sparkline window
 * (24 or 168) and the bucket granularity; the headline counts stay fixed
 * (today = 24h, last7d = 168h) regardless.
 */
export async function getWebhookStats(windowHours = 24): Promise<WebhookStats> {
  const isWeek = windowHours >= 168;
  const bucketExpr = isWeek
    ? sql<string>`date_trunc('day', ${webhookEvents.createdAt})`
    : sql<string>`date_trunc('hour', ${webhookEvents.createdAt})`;
  const bucketSince = isWeek
    ? sql`now() - interval '7 days'`
    : sql`now() - interval '24 hours'`;

  const [counts, byTypeRows, byRepoRows, senderRows, actionRows, hourlyRows] =
    await Promise.all([
      db
        .select({
          today: TODAY_COUNT,
          last7d: LAST7D_COUNT,
          total: COUNT,
          prTotal:
            sql<number>`count(*) filter (where ${webhookEvents.eventType} = 'pull_request')`.mapWith(
              Number
            ),
          prTriggered:
            sql<number>`count(${webhookEvents.triggeredRun}) filter (where ${webhookEvents.eventType} = 'pull_request')`.mapWith(
              Number
            ),
        })
        .from(webhookEvents),
      db
        .select({ eventType: webhookEvents.eventType, count: COUNT })
        .from(webhookEvents)
        .groupBy(webhookEvents.eventType)
        .orderBy(desc(COUNT)),
      db
        .select({
          repoKey: webhookEvents.repoKey,
          count: COUNT,
          triggered: TRIGGERED_COUNT,
          lastSeen: LAST_SEEN,
        })
        .from(webhookEvents)
        .where(sql`${webhookEvents.createdAt} > now() - interval '7 days'`)
        .groupBy(webhookEvents.repoKey)
        .orderBy(desc(COUNT)),
      db
        .select({ login: webhookEvents.senderLogin, count: COUNT })
        .from(webhookEvents)
        .where(isNotNull(webhookEvents.senderLogin))
        .groupBy(webhookEvents.senderLogin)
        .orderBy(desc(COUNT))
        .limit(8),
      db
        .select({ action: webhookEvents.action, count: COUNT })
        .from(webhookEvents)
        .where(isNotNull(webhookEvents.action))
        .groupBy(webhookEvents.action)
        .orderBy(desc(COUNT))
        .limit(12),
      db
        .select({ bucket: bucketExpr, count: COUNT })
        .from(webhookEvents)
        .where(sql`${webhookEvents.createdAt} > ${bucketSince}`)
        .groupBy(bucketExpr)
        .orderBy(bucketExpr),
    ]);

  const c = counts[0];

  return {
    todayCount: c?.today ?? 0,
    last7dCount: c?.last7d ?? 0,
    totalCount: c?.total ?? 0,
    actionRate: {
      triggered: c?.prTriggered ?? 0,
      totalPr: c?.prTotal ?? 0,
    },
    byType: byTypeRows.map((r) => ({
      eventType: r.eventType,
      count: r.count,
    })),
    byRepo: byRepoRows.map((r) => ({
      repoKey: r.repoKey,
      count: r.count,
      triggered: r.triggered,
      lastSeen: toIso(r.lastSeen as Date | string | null),
    })),
    senders: senderRows
      .filter((r): r is { login: string; count: number } => r.login !== null)
      .map((r) => ({
        login: r.login,
        count: r.count,
        isBot: isBotLogin(r.login),
      })),
    topActions: actionRows
      .filter((r): r is { action: string; count: number } => r.action !== null)
      .map((r) => ({ action: r.action, count: r.count })),
    hourly: hourlyRows.map((r) => ({
      hour: toIso(r.bucket as Date | string | null) ?? "",
      count: r.count,
    })),
    windowHours,
  };
}

/**
 * repo_settings rows enriched with the last 7 days of per-repo activity and
 * the most recent delivery timestamp (the v1 "is this hook alive?" signal).
 * github_hook_id is surfaced raw so the UI can honestly say "not recorded"
 * rather than faking GitHub-side delivery health.
 */
export async function getIngressRepos(): Promise<IngressRepo[]> {
  const [settings, activity] = await Promise.all([
    db
      .select()
      .from(repoSettings)
      .orderBy(desc(repoSettings.webhookEnabled), repoSettings.repoKey),
    db
      .select({
        repoKey: webhookEvents.repoKey,
        count7d: LAST7D_COUNT,
        triggered7d:
          sql<number>`count(${webhookEvents.triggeredRun}) filter (where ${webhookEvents.createdAt} > now() - interval '7 days')`.mapWith(
            Number
          ),
        lastEvent: LAST_SEEN,
      })
      .from(webhookEvents)
      .groupBy(webhookEvents.repoKey),
  ]);

  const activityMap = new Map<
    string,
    { count7d: number; triggered7d: number; lastEvent: Date | string | null }
  >();
  for (const row of activity) {
    activityMap.set(row.repoKey, {
      count7d: row.count7d,
      triggered7d: row.triggered7d,
      lastEvent: row.lastEvent as Date | string | null,
    });
  }

  return settings.map((s) => {
    const act = activityMap.get(s.repoKey);
    return {
      repoKey: s.repoKey,
      owner: s.owner,
      repo: s.repo,
      webhookEnabled: s.webhookEnabled,
      autoFix: s.autoFix,
      githubHookId: s.githubHookId,
      notes: s.notes,
      count7d: act?.count7d ?? 0,
      triggered7d: act?.triggered7d ?? 0,
      lastEventAt: toIso(act?.lastEvent ?? null),
    };
  });
}
