import { NextResponse } from "next/server";
import { buildOverview } from "@/lib/tars/dashboard-overview";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const overview = await buildOverview();
    return NextResponse.json(overview);
  } catch (err) {
    console.error("GET /api/tars/dashboard/overview error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
