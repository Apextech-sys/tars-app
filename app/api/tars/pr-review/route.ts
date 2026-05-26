/**
 * API route handler: POST /api/tars/pr-review
 *
 * Starts a PR review workflow run. Returns { runId } immediately; the run
 * progresses asynchronously via world-postgres + graphile-worker.
 *
 * The integration test polls /api/tars/pr-review/[runId] until status !==
 * "started". The status is stored in the `pr_review_runs` table by the
 * workflow itself (see workflows/lib/audit.ts upsertPrReviewRun).
 *
 * INSTALL: copy this file to app/api/tars/pr-review/route.ts.
 */

import { NextResponse } from "next/server";
import { start } from "workflow/api";

import { prReviewWorkflow, type PRReviewInput } from "@/workflows/pr-review";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PRReviewInput & {
      authToken?: string;
    };

    // Lightweight shared-secret guard — the integration test sets
    // TARS_INTERNAL_SECRET and passes it as authToken. In production this
    // route will be replaced with the GitHub webhook handler.
    const expected = process.env.TARS_INTERNAL_SECRET;
    if (expected && body.authToken !== expected) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    if (!body.owner || !body.repo || !body.prNumber) {
      return NextResponse.json(
        { error: "owner, repo, prNumber required" },
        { status: 400 }
      );
    }

    const input: PRReviewInput = {
      owner: body.owner,
      repo: body.repo,
      prNumber: body.prNumber,
      policyOverride: body.policyOverride,
      dryRun: body.dryRun,
    };

    const run = await start(prReviewWorkflow, [input]);
    // The workflow generates its own runId (prrev_...) but we also surface
    // the world-postgres run.runId so callers can inspect via the WDK API too.
    return NextResponse.json({
      workflowRunId: run.runId,
      status: "queued",
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "start failed",
        stack: err instanceof Error ? err.stack : undefined,
      },
      { status: 500 }
    );
  }
}
