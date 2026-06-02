import { NextResponse } from "next/server";
import { listKnowledgeDocs } from "@/lib/tars/graph-docs";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { available, docs } = await listKnowledgeDocs();
    return NextResponse.json({ available, docs });
  } catch (err) {
    console.error("GET /api/tars/knowledge error", err);
    return NextResponse.json({ available: false, docs: [] }, { status: 200 });
  }
}
