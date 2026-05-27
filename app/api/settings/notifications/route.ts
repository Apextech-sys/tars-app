import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/tars-schema";

export const runtime = "nodejs";

const bodySchema = z.object({
  enabled: z.boolean(),
  severity_threshold: z.enum(["info", "warn", "blocker"]),
});

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }
    await db
      .insert(appSettings)
      .values({ key: "notifications", value: parsed.data })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: {
          value: parsed.data,
          updatedAt: new Date(),
        },
      });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to save notification settings", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function GET(): Promise<NextResponse> {
  try {
    const row = await db.query.appSettings.findFirst({
      where: (t, { eq }) => eq(t.key, "notifications"),
    });
    if (!row) {
      return NextResponse.json({ enabled: false, severity_threshold: "warn" });
    }
    return NextResponse.json(row.value);
  } catch (err) {
    console.error("Failed to load notification settings", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
