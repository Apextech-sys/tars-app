import { asc, eq, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auditLog, prReviewRuns, webhookEvents } from "@/lib/db/tars-schema";
import { tarsJobs } from "@/lib/db/worker-schema";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;

    const [runRows, auditRows, webhookRows, jobRows] = await Promise.all([
      db
        .select({
          runId: prReviewRuns.runId,
          owner: prReviewRuns.owner,
          repo: prReviewRuns.repo,
          prNumber: prReviewRuns.prNumber,
          prSha: prReviewRuns.prSha,
          policy: prReviewRuns.policy,
          status: prReviewRuns.status,
          findingsCount: prReviewRuns.findingsCount,
          reviewCommentUrl: prReviewRuns.reviewCommentUrl,
          error: prReviewRuns.error,
          disagreedPayload: prReviewRuns.disagreedPayload,
          adjudicationAction: prReviewRuns.adjudicationAction,
          adjudicationActionAt: prReviewRuns.adjudicationActionAt,
          agreedFindings: prReviewRuns.agreedFindings,
          linearIssueId: prReviewRuns.linearIssueId,
          linearIssueIdentifier: prReviewRuns.linearIssueIdentifier,
          linearIssueUrl: prReviewRuns.linearIssueUrl,
          approvalAction: prReviewRuns.approvalAction,
          approvalActionAt: prReviewRuns.approvalActionAt,
          approvalReason: prReviewRuns.approvalReason,
          fixStatus: prReviewRuns.fixStatus,
          fixBranch: prReviewRuns.fixBranch,
          fixPrUrl: prReviewRuns.fixPrUrl,
          fixPrNumber: prReviewRuns.fixPrNumber,
          fixRevalidation: prReviewRuns.fixRevalidation,
          fixBlastRadius: prReviewRuns.fixBlastRadius,
          fixCoverageRootcause: prReviewRuns.fixCoverageRootcause,
          archivedAt: prReviewRuns.archivedAt,
          createdAt: prReviewRuns.createdAt,
          updatedAt: prReviewRuns.updatedAt,
        })
        .from(prReviewRuns)
        .where(eq(prReviewRuns.runId, runId))
        .limit(1),
      db
        .select()
        .from(auditLog)
        .where(eq(auditLog.runId, runId))
        .orderBy(asc(auditLog.createdAt)),
      db
        .select()
        .from(webhookEvents)
        .where(eq(webhookEvents.triggeredRun, runId))
        .limit(1),
      db
        .select()
        .from(tarsJobs)
        .where(sql`${tarsJobs.payload}->>'runId' = ${runId}`)
        .orderBy(asc(tarsJobs.createdAt)),
    ]);

    if (runRows.length === 0) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const run = runRows[0];
    const webhook = webhookRows[0] ?? null;

    return NextResponse.json({
      run: {
        ...run,
        createdAt: run.createdAt.toISOString(),
        updatedAt: run.updatedAt.toISOString(),
        adjudicationActionAt: run.adjudicationActionAt?.toISOString() ?? null,
        approvalActionAt: run.approvalActionAt?.toISOString() ?? null,
        archivedAt: run.archivedAt?.toISOString() ?? null,
      },
      auditLog: auditRows.map((a) => ({
        ...a,
        createdAt: a.createdAt.toISOString(),
      })),
      webhookEvent: webhook
        ? {
            ...webhook,
            createdAt: webhook.createdAt.toISOString(),
          }
        : null,
      jobs: jobRows.map((j) => ({
        ...j,
        createdAt: j.createdAt.toISOString(),
        startedAt: j.startedAt?.toISOString() ?? null,
        completedAt: j.completedAt?.toISOString() ?? null,
        lockedAt: j.lockedAt?.toISOString() ?? null,
      })),
    });
  } catch (err) {
    console.error("GET /api/tars/pr-runs/[runId] error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
