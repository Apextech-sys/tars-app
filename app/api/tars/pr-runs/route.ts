import {
  and,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { prReviewRuns, webhookEvents } from "@/lib/db/tars-schema";

const querySchema = z.object({
  status: z.string().optional(),
  repo: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  /** "true" = only archived; "false" = only non-archived; omitted = all. */
  archived: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function GET(req: NextRequest) {
  try {
    const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
    const params = querySchema.parse(sp);

    const conditions = [];

    if (params.status) {
      const statuses = params.status.split(",").map((s) => s.trim());
      if (statuses.length === 1) {
        conditions.push(eq(prReviewRuns.status, statuses[0]));
      } else {
        conditions.push(or(...statuses.map((s) => eq(prReviewRuns.status, s))));
      }
    }

    if (params.repo) {
      const [owner, repo] = params.repo.includes("/")
        ? params.repo.split("/", 2)
        : [undefined, params.repo];
      if (owner) {
        conditions.push(eq(prReviewRuns.owner, owner));
      }
      if (repo) {
        conditions.push(eq(prReviewRuns.repo, repo));
      }
    }

    if (params.from) {
      conditions.push(gte(prReviewRuns.createdAt, new Date(params.from)));
    }
    if (params.to) {
      conditions.push(lte(prReviewRuns.createdAt, new Date(params.to)));
    }
    if (params.archived === "true") {
      conditions.push(isNotNull(prReviewRuns.archivedAt));
    } else if (params.archived === "false") {
      conditions.push(isNull(prReviewRuns.archivedAt));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, countResult] = await Promise.all([
      db
        .select({
          runId: prReviewRuns.runId,
          owner: prReviewRuns.owner,
          repo: prReviewRuns.repo,
          prNumber: prReviewRuns.prNumber,
          prSha: prReviewRuns.prSha,
          status: prReviewRuns.status,
          findingsCount: prReviewRuns.findingsCount,
          reviewCommentUrl: prReviewRuns.reviewCommentUrl,
          error: prReviewRuns.error,
          adjudicationAction: prReviewRuns.adjudicationAction,
          archivedAt: prReviewRuns.archivedAt,
          createdAt: prReviewRuns.createdAt,
          updatedAt: prReviewRuns.updatedAt,
          // Join webhook event for pr_title
          prTitle: webhookEvents.prTitle,
          senderLogin: webhookEvents.senderLogin,
        })
        .from(prReviewRuns)
        .leftJoin(
          webhookEvents,
          eq(webhookEvents.triggeredRun, prReviewRuns.runId)
        )
        .where(where)
        .orderBy(desc(prReviewRuns.updatedAt))
        .limit(params.limit)
        .offset(params.offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(prReviewRuns)
        .where(where),
    ]);

    return NextResponse.json({
      runs: rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        archivedAt: r.archivedAt?.toISOString() ?? null,
      })),
      total: countResult[0]?.count ?? 0,
      limit: params.limit,
      offset: params.offset,
    });
  } catch (err) {
    console.error("GET /api/tars/pr-runs error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
