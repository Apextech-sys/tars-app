import { NextResponse } from "next/server";
import { getIngressRepos } from "@/lib/tars/webhooks-stats";

export const dynamic = "force-dynamic";

/**
 * GET /api/tars/webhooks/ingress
 *
 * Configured ingress endpoints (repo_settings) enriched with per-repo 7d
 * activity + last-event-seen. Pure DB; no GitHub-side call for v1 health.
 */
export async function GET() {
  try {
    const repos = await getIngressRepos();
    return NextResponse.json({ repos });
  } catch (err) {
    console.error("GET /api/tars/webhooks/ingress error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
