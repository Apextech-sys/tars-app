import { desc, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auditLog, webhookEvents } from "@/lib/db/tars-schema";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * Cross-domain recent-activity feed for the dashboard command center.
 *
 * Returns the most recent audit_log rows (every workflow, not just PR runs)
 * left-joined to webhook_events for a human-readable PR title when one exists.
 * `prTitle` is NULL for every current row (the webhook→run link is not yet
 * written), so the client falls back to "PR #NNN"; the join is wired now so
 * titles light up automatically once the link is populated.
 */
export async function GET(req: NextRequest) {
  try {
    const limitParam = Number.parseInt(
      req.nextUrl.searchParams.get("limit") ?? "",
      10
    );
    const limit = Math.min(
      Math.max(Number.isNaN(limitParam) ? DEFAULT_LIMIT : limitParam, 1),
      MAX_LIMIT
    );

    const rows = await db
      .select({
        id: auditLog.id,
        runId: auditLog.runId,
        workflow: auditLog.workflow,
        step: auditLog.step,
        status: auditLog.status,
        owner: auditLog.owner,
        repo: auditLog.repo,
        prNumber: auditLog.prNumber,
        message: auditLog.message,
        createdAt: auditLog.createdAt,
        prTitle: webhookEvents.prTitle,
      })
      .from(auditLog)
      .leftJoin(webhookEvents, eq(webhookEvents.triggeredRun, auditLog.runId))
      .orderBy(desc(auditLog.createdAt))
      .limit(limit);

    return NextResponse.json({
      rows: rows.map((r) => ({
        id: r.id,
        runId: r.runId,
        workflow: r.workflow,
        step: r.step,
        status: r.status,
        owner: r.owner,
        repo: r.repo,
        prNumber: r.prNumber,
        message: r.message,
        prTitle: r.prTitle,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("GET /api/tars/dashboard/feed error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
