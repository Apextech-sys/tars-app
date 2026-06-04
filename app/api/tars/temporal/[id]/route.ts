import { NextResponse } from "next/server";
import { getWorkflowDetail } from "@/lib/tars/graph-temporal";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params;
    const runId = new URL(req.url).searchParams.get("runId") ?? "";
    return NextResponse.json(await getWorkflowDetail(id, runId));
  } catch (err) {
    console.error("GET /api/tars/temporal/[id] error", err);
    return NextResponse.json({ available: false }, { status: 200 });
  }
}
