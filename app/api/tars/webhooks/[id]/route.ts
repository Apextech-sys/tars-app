import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { webhookEvents } from "@/lib/db/tars-schema";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const rows = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.id, Number.parseInt(id, 10)))
      .limit(1);

    if (rows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const e = rows[0];
    return NextResponse.json({
      ...e,
      createdAt: e.createdAt.toISOString(),
    });
  } catch (err) {
    console.error("GET /api/tars/webhooks/[id] error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
