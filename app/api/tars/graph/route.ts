import { NextResponse } from "next/server";
import {
  getGraphNode,
  getGraphStats,
  searchGraph,
} from "@/lib/tars/graph-explore";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const op = searchParams.get("op");
  if (op === "search") {
    return NextResponse.json({
      results: await searchGraph(searchParams.get("q") ?? ""),
    });
  }
  if (op === "node") {
    return NextResponse.json(await getGraphNode(searchParams.get("id") ?? ""));
  }
  return NextResponse.json(await getGraphStats());
}
