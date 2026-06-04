/**
 * POST /api/tars/webhooks/[id]/replay
 *
 * Re-processes a stored GitHub webhook delivery: re-triggers the PR review
 * workflow for the same owner/repo/prNumber the delivery carried. This is the
 * real backing for the "Re-run PR review" control on the /webhooks console.
 *
 * It re-uses the same canonical internal entry point the live webhook handler
 * uses (`POST /api/tars/pr-review`, guarded by TARS_INTERNAL_SECRET), so a
 * replayed run is identical to an organically-triggered one (it gets its own
 * fresh `prrev_…` run id, fetches the PR from GitHub, captures pr_title/author,
 * etc.). We do NOT re-verify an HMAC here — replay is an authenticated internal
 * action initiated from the Tailscale-only dashboard, not public ingress.
 *
 * Responses:
 *   - 202  re-run enqueued (returns the new workflowRunId)
 *   - 404  no such webhook_events row
 *   - 422  the delivery can't be replayed (not a pull_request event, or the
 *          payload lacks owner/repo/prNumber)
 *   - 500  internal error (e.g. the pr-review route rejected the call)
 */

import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { webhookEvents } from "@/lib/db/tars-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ReplayablePayload {
  number?: number;
  pull_request?: { number?: number };
  repository?: {
    owner?: { login?: string };
    name?: string;
  };
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const numericId = Number.parseInt(id, 10);
    if (Number.isNaN(numericId)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const rows = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.id, numericId))
      .limit(1);

    if (rows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const event = rows[0];
    if (event.eventType !== "pull_request") {
      return NextResponse.json(
        { error: "Only pull_request deliveries can be replayed" },
        { status: 422 }
      );
    }

    const payload = (event.rawPayload ?? {}) as ReplayablePayload;
    const owner = payload.repository?.owner?.login;
    const repo = payload.repository?.name;
    const prNumber =
      event.prNumber ?? payload.number ?? payload.pull_request?.number ?? null;

    if (!(owner && repo && prNumber)) {
      return NextResponse.json(
        {
          error:
            "Delivery payload is missing owner/repo/prNumber — cannot replay",
        },
        { status: 422 }
      );
    }

    const internalUrl = `${process.env.API_URL ?? "http://127.0.0.1:3001"}/api/tars/pr-review`;
    const workflowResp = await fetch(internalUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        owner,
        repo,
        prNumber,
        authToken: process.env.TARS_INTERNAL_SECRET,
        _triggeredBy: "webhook_replay",
        _replayedDeliveryId: event.deliveryId,
      }),
    });

    if (!workflowResp.ok) {
      const errText = await workflowResp.text();
      console.error(
        `[webhooks/replay] pr-review trigger failed: status=${workflowResp.status} body=${errText}`
      );
      return NextResponse.json(
        { error: "Failed to enqueue PR review" },
        { status: 500 }
      );
    }

    const data = (await workflowResp.json()) as { workflowRunId?: string };
    return NextResponse.json(
      {
        accepted: true,
        repo: `${owner}/${repo}`,
        prNumber,
        workflowRunId: data.workflowRunId ?? null,
      },
      { status: 202 }
    );
  } catch (err) {
    console.error("POST /api/tars/webhooks/[id]/replay error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
