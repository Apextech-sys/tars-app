/**
 * API: POST /api/tars/retention-archive  — start a retention-archive run.
 *
 * Auth: shared-secret via authToken matching TARS_INTERNAL_SECRET (same
 * pattern as /api/tars/pr-review and /api/tars/briefs). Invoked daily by
 * the `tars-retention-archive.timer` systemd unit.
 *
 * See workflows/retention-archive.ts for what the run does.
 */

import { NextResponse } from "next/server";
import { start } from "workflow/api";

import { timingSafeAuthTokenEqual } from "@/lib/auth/internal-secret";
import {
  type RetentionInput,
  retentionArchiveWorkflow,
} from "@/workflows/retention-archive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized(): NextResponse {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

function authCheck(authToken: string | undefined | null): boolean {
  const expected = process.env.TARS_INTERNAL_SECRET;
  if (!expected) {
    return true; // dev convenience; deploy sets it
  }
  return timingSafeAuthTokenEqual(authToken, expected);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Partial<
      RetentionInput & { authToken?: string }
    >;
    if (!authCheck(body.authToken)) {
      return unauthorized();
    }

    const input: RetentionInput = {
      cutoffIso: body.cutoffIso,
      batchSize: body.batchSize,
      dryRun: body.dryRun,
    };
    const run = await start(retentionArchiveWorkflow, [input]);
    return NextResponse.json({
      workflowRunId: run.runId,
      status: "queued",
      input,
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
