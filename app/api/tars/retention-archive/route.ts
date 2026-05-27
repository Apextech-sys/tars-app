/**
 * API: POST /api/tars/retention-archive  — start a retention-archive run.
 *
 * Auth: shared-secret via authToken matching TARS_INTERNAL_SECRET (same
 * pattern as /api/tars/pr-review and /api/tars/briefs). Invoked daily by
 * the `tars-retention-archive.timer` systemd unit.
 *
 * See workflows/retention-archive.ts for what the run does.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { start } from "workflow/api";

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
  if (!authToken) {
    return false;
  }
  // Compare hashes to side-step the length-mismatch constraint of
  // timingSafeEqual on the raw secret strings.
  const a = createHash("sha256").update(authToken).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
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
