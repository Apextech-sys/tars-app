import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getWorkflowRuns } from "@/lib/tars/workflows";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  status: z.string().optional(),
  repo: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * GET /api/tars/workflows/runs
 *
 * Cross-workflow paginated run feed (pr-review today; designed to union briefs
 * and other workflows once they emit). Filters: status (comma-separated), repo,
 * from/to, limit/offset — mirrors the /api/tars/pr-runs query surface.
 */
export async function GET(req: NextRequest) {
  try {
    const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
    const params = querySchema.parse(sp);
    const statusList = params.status
      ? params.status
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;

    const result = await getWorkflowRuns({
      status: statusList,
      repo: params.repo ?? null,
      from: params.from ?? null,
      to: params.to ?? null,
      limit: params.limit,
      offset: params.offset,
    });

    return NextResponse.json({
      runs: result.runs,
      total: result.total,
      limit: params.limit,
      offset: params.offset,
    });
  } catch (err) {
    console.error("GET /api/tars/workflows/runs error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
