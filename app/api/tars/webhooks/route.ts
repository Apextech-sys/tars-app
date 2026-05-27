import { and, desc, eq, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { webhookEvents } from "@/lib/db/tars-schema";

const querySchema = z.object({
  repo: z.string().optional(),
  event: z.string().optional(),
  action: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function GET(req: NextRequest) {
  try {
    const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
    const params = querySchema.parse(sp);

    const conditions = [];

    if (params.repo) {
      conditions.push(eq(webhookEvents.repoKey, params.repo));
    }
    if (params.event) {
      conditions.push(eq(webhookEvents.eventType, params.event));
    }
    if (params.action) {
      conditions.push(eq(webhookEvents.action, params.action));
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
