"use server";

import { and, eq, gte, lt, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { escalations, prReviewRuns } from "@/lib/db/tars-schema";
import { tarsJobs } from "@/lib/db/worker-schema";

// ---------- helpers ----------

function nowPlusSecs(s: number): Date {
  return new Date(Date.now() + s * 1000);
}

// ---------- inbox data fetch ----------

export type InboxItem =
  | {
      kind: "escalation";
      id: string;
      source: string;
      severity: "info" | "warn" | "blocker";
      title: string;
      bodyMarkdown: string | null;
      status: "open" | "snoozed" | "resolved" | "deferred";
      snoozedUntil: string | null;
      createdAt: string;
    }
  | {
      kind: "workflow_stall";
      id: string;
      runId: string;
      repo: string;
      prNumber: number;
      status: string;
      createdAt: string;
    }
  | {
      kind: "worker_failure";
      id: string;
      jobKind: string;
      errorText: string | null;
      createdAt: string;
    }
  | {
      kind: "pr_failure";
      id: string;
      runId: string;
      repo: string;
      prNumber: number;
      error: string;
      createdAt: string;
    }
  | {
      kind: "pr_disagreement";
      id: string;
      runId: string;
      repo: string;
      prNumber: number;
      prSha: string | null;
      codexFindingsCount: number;
      claudeFindingsCount: number;
      overlapRatio: number | null;
      createdAt: string;
    };

export async function fetchInboxItems(): Promise<InboxItem[]> {
  const items: InboxItem[] = [];

  // 1. Open / snoozed escalations
  const escRows = await db
    .select()
    .from(escalations)
    .where(
      or(
        eq(escalations.status, "open"),
        and(
          eq(escalations.status, "snoozed"),
          gte(escalations.snoozedUntil, sql`now()`)
        )
      )
    )
    .orderBy(sql`${escalations.createdAt} DESC`)
    .limit(100);

  for (const r of escRows) {
    items.push({
      kind: "escalation",
      id: r.id,
      source: r.source,
      severity: r.severity as "info" | "warn" | "blocker",
      title: r.title,
      bodyMarkdown: r.bodyMarkdown,
      status: r.status as "open" | "snoozed" | "resolved" | "deferred",
      snoozedUntil: r.snoozedUntil?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    });
  }

  // 2. Stalled PR review runs (status='started' > 5 min old)
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const stalledRuns = await db
    .select()
    .from(prReviewRuns)
    .where(
      and(
        eq(prReviewRuns.status, "started"),
        lt(prReviewRuns.createdAt, fiveMinAgo)
      )
    )
    .limit(50);

  for (const r of stalledRuns) {
    items.push({
      kind: "workflow_stall",
      id: `stall-${r.runId}`,
      runId: r.runId,
      repo: `${r.owner}/${r.repo}`,
      prNumber: r.prNumber,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    });
  }

  // 3. Failed tars_jobs (last 7 days)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const failedJobs = await db
    .select()
    .from(tarsJobs)
    .where(
      and(eq(tarsJobs.status, "failed"), gte(tarsJobs.createdAt, sevenDaysAgo))
    )
    .orderBy(sql`${tarsJobs.createdAt} DESC`)
    .limit(50);

  for (const r of failedJobs) {
    items.push({
      kind: "worker_failure",
      id: `job-${r.id}`,
      jobKind: r.kind,
      errorText: r.errorText,
      createdAt: r.createdAt.toISOString(),
    });
  }

  // 4. Failed PR review runs (error IS NOT NULL)
  const failedPRs = await db
    .select()
    .from(prReviewRuns)
    .where(sql`${prReviewRuns.error} IS NOT NULL`)
    .orderBy(sql`${prReviewRuns.createdAt} DESC`)
    .limit(50);

  for (const r of failedPRs) {
    items.push({
      kind: "pr_failure",
      id: `prfail-${r.runId}`,
      runId: r.runId,
      repo: `${r.owner}/${r.repo}`,
      prNumber: r.prNumber,
      error: r.error ?? "unknown error",
      createdAt: r.createdAt.toISOString(),
    });
  }

  // 5. Disagreed PR review runs — Codex/Claude disagreed; no public comment
  //    was posted. Shaun needs to adjudicate from /inbox.
  const disagreedPRs = await db
    .select()
    .from(prReviewRuns)
    .where(eq(prReviewRuns.status, "disagreed"))
    .orderBy(sql`${prReviewRuns.createdAt} DESC`)
    .limit(50);

  for (const r of disagreedPRs) {
    const payload = r.disagreedPayload as {
      codex?: { findings?: unknown[] };
      claude?: { findings?: unknown[] };
      overlapRatio?: number;
    } | null;
    items.push({
      kind: "pr_disagreement",
      id: `prdis-${r.runId}`,
      runId: r.runId,
      repo: `${r.owner}/${r.repo}`,
      prNumber: r.prNumber,
      prSha: r.prSha,
      codexFindingsCount: payload?.codex?.findings?.length ?? 0,
      claudeFindingsCount: payload?.claude?.findings?.length ?? 0,
      overlapRatio:
        typeof payload?.overlapRatio === "number" ? payload.overlapRatio : null,
      createdAt: r.createdAt.toISOString(),
    });
  }

  return items;
}

export async function fetchInboxBadgeCount(): Promise<number> {
  const items = await fetchInboxItems();
  return items.filter((i) => i.kind !== "escalation" || i.status === "open")
    .length;
}

/**
 * Returns the full disagreed_payload for a single PR review run so Shaun
 * can inspect the raw Codex and Claude outputs side-by-side from the inbox.
 */
export async function fetchPrDisagreement(runId: string): Promise<{
  runId: string;
  owner: string;
  repo: string;
  prNumber: number;
  prSha: string | null;
  createdAt: string;
  payload: unknown;
} | null> {
  const rows = await db
    .select()
    .from(prReviewRuns)
    .where(
      and(eq(prReviewRuns.runId, runId), eq(prReviewRuns.status, "disagreed"))
    )
    .limit(1);
  if (rows.length === 0) {
    return null;
  }
  const r = rows[0];
  return {
    runId: r.runId,
    owner: r.owner,
    repo: r.repo,
    prNumber: r.prNumber,
    prSha: r.prSha,
    createdAt: r.createdAt.toISOString(),
    payload: r.disagreedPayload,
  };
}

// ---------- mutations ----------

export async function resolveEscalation(id: string, note: string) {
  await db
    .update(escalations)
    .set({
      status: "resolved",
      resolvedAt: new Date(),
      resolvedBy: "shaun",
      resolutionNote: note,
      updatedAt: new Date(),
    })
    .where(eq(escalations.id, id));
  try {
    revalidatePath("/inbox");
  } catch {
    /* no-op outside request context */
  }
}

export async function snoozeEscalation(id: string, hours: number) {
  await db
    .update(escalations)
    .set({
      status: "snoozed",
      snoozedUntil: nowPlusSecs(hours * 3600),
      updatedAt: new Date(),
    })
    .where(eq(escalations.id, id));
  try {
    revalidatePath("/inbox");
  } catch {
    /* no-op outside request context */
  }
}

export async function deferEscalation(id: string) {
  await db
    .update(escalations)
    .set({ status: "deferred", updatedAt: new Date() })
    .where(eq(escalations.id, id));
  try {
    revalidatePath("/inbox");
  } catch {
    /* no-op outside request context */
  }
}

export async function createEscalation(data: {
  source: string;
  severity: "info" | "warn" | "blocker";
  title: string;
  bodyMarkdown?: string;
  payload?: Record<string, unknown>;
}) {
  await db.insert(escalations).values({
    source: data.source,
    severity: data.severity,
    title: data.title,
    bodyMarkdown: data.bodyMarkdown ?? null,
    payload: data.payload ?? null,
    status: "open",
  });
  try {
    revalidatePath("/inbox");
  } catch {
    /* no-op outside request context */
  }
}
