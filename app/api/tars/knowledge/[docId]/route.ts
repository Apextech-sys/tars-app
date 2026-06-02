import { type NextRequest, NextResponse } from "next/server";
import { getKnowledgeDoc } from "@/lib/tars/graph-docs";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ docId: string }> }
) {
  try {
    const { docId } = await params;
    const detail = await getKnowledgeDoc(docId);
    return NextResponse.json(detail);
  } catch (err) {
    console.error("GET /api/tars/knowledge/[docId] error", err);
    return NextResponse.json(
      {
        available: false,
        found: false,
        doc: null,
        files: [],
        tickets: [],
        repos: [],
      },
      { status: 200 }
    );
  }
}
