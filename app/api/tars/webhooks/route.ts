import {
  and,
  desc,
  eq,
  gt,
  ilike,
  isNotNull,
  isNull,
  type SQL,
  sql,
} from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { webhookEvents } from "@/lib/db/tars-schema";

const querySchema = z.object({
  repo: z.string().optional(),
  event: z.string().optional(),
  action: z.string().optional(),
  sender: z.string().optional(),
  search: z.string().optional(),
  since: z.enum(["24h", "7d"]).optional(),
  outcome: z.enum(["triggered", "merged", "skipped", "no_action"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const MERGED_PATTERN = sql`(${webhookEvents.action} ilike '%\\_\\_merged' or ${webhookEvents.action} ilike '%fix\\_merged%')`;
const DRAFT_PATTERN = sql`${webhookEvents.action} ilike '%draft\\_skip%'`;

export async function GET(req: NextRequest) {
  try {
    const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
    const params = querySchema.parse(sp);

    const conditions: SQL[] = [];

    if (params.repo) {
      conditions.push(eq(webhookEvents.repoKey, params.repo));
    }
    if (params.event) {
      conditions.push(eq(webhookEvents.eventType, params.event));
    }
    if (params.action) {
      conditions.push(eq(webhookEvents.action, params.action));
    }
    if (params.sender) {
      conditions.push(eq(webhookEvents.senderLogin, params.sender));
    }
    if (params.search) {
      conditions.push(ilike(webhookEvents.prTitle, `%${params.search}%`));
    }
    if (params.since === "24h") {
      conditions.push(
        gt(webhookEvents.createdAt, sql`now() - interval '24 hours'`)
      );
    }
    if (params.since === "7d") {
      conditions.push(
        gt(webhookEvents.createdAt, sql`now() - interval '7 days'`)
      );
    }
    if (params.outcome === "triggered") {
      conditions.push(isNotNull(webhookEvents.triggeredRun));
    }
    if (params.outcome === "merged") {
      conditions.push(MERGED_PATTERN);
    }
    if (params.outcome === "skipped") {
      conditions.push(DRAFT_PATTERN);
    }
    if (params.outcome === "no_action") {
      conditions.push(isNull(webhookEvents.triggeredRun));
      conditions.push(sql`not ${MERGED_PATTERN}`);
      conditions.push(sql`not ${DRAFT_PATTERN}`);
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, countResult] = await Promise.all([
      db
        .select()
        .from(webhookEvents)
        .where(where)
        .orderBy(desc(webhookEvents.createdAt))
        .limit(params.limit)
        .offset(params.offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(webhookEvents)
        .where(where),
    ]);

    return NextResponse.json({
      events: rows.map((e) => ({
        ...e,
        rawPayload: undefined, // don't send raw on list
        createdAt: e.createdAt.toISOString(),
      })),
      total: countResult[0]?.count ?? 0,
      limit: params.limit,
      offset: params.offset,
    });
  } catch (err) {
    console.error("GET /api/tars/webhooks error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
