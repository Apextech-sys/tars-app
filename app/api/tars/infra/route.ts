import { NextResponse } from "next/server";
import { getInfra } from "@/lib/tars/graph-aws";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const infra = await getInfra();
    return NextResponse.json(infra);
  } catch (err) {
    console.error("GET /api/tars/infra error", err);
    return NextResponse.json({ available: false }, { status: 200 });
  }
}
