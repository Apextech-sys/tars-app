import { NextResponse } from "next/server";
import { getTemporal } from "@/lib/tars/graph-temporal";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getTemporal());
  } catch (err) {
    console.error("GET /api/tars/temporal error", err);
    return NextResponse.json({ available: false }, { status: 200 });
  }
}
