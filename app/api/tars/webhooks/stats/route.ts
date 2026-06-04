import { type NextRequest, NextResponse } from "next/server";
import { getWebhookStats } from "@/lib/tars/webhooks-stats";

export const dynamic = "force-dynamic";

/**
 * GET /api/tars/webhooks/stats?window=24|168
 *
 * Full-table aggregate stats powering the /webhooks hero band + breakdown
 * strips + the 24h/7d sparkline. Always computed over the whole
 * webhook_events table, never a single page.
 */
export async function GET(req: NextRequest) {
  try {
    const windowParam = req.nextUrl.searchParams.get("window");
    const windowHours = windowParam === "168" ? 168 : 24;
    const stats = await getWebhookStats(windowHours);
    return NextResponse.json(stats);
  } catch (err) {
    console.error("GET /api/tars/webhooks/stats error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
