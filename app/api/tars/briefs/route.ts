/**
 * API: POST /api/tars/briefs  — start a brief workflow run.
 *        GET  /api/tars/briefs  — list recent briefs.
 *
 * Auth: shared-secret via authToken matching TARS_INTERNAL_SECRET (same
 * pattern as /api/tars/pr-review). The systemd timer hits this endpoint
 * with the secret so we don't run workflows on cold paths.
 */

import { NextResponse } from "next/server";
import postgres from "postgres";
import { start } from "workflow/api";

import { timingSafeAuthTokenEqual } from "@/lib/auth/internal-secret";
import { type BriefWorkflowInput, briefWorkflow } from "@/workflows/brief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let sqlClient: ReturnType<typeof postgres> | null = null;
function getSql() {
  if (sqlClient) {
    return sqlClient;
  }
  const url =
    process.env.WORKFLOW_POSTGRES_URL ??
    process.env.DATABASE_URL ??
    "postgres://tars_app:5bb16db4a6db588a087139b7225537595c0140791c0a037a@127.0.0.1:5433/tars_app";
  sqlClient = postgres(url, { max: 4, idle_timeout: 20, prepare: false });
  return sqlClient;
}

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
      BriefWorkflowInput & { authToken?: string }
    >;
    if (!authCheck(body.authToken)) {
      return unauthorized();
    }

    if (!(body.kind && ["morning", "evening", "adhoc"].includes(body.kind))) {
      return NextResponse.json(
        { error: "kind must be morning|evening|adhoc" },
        { status: 400 }
      );
    }

    const input: BriefWorkflowInput = {
      kind: body.kind,
      date: body.date,
      windowStart: body.windowStart,
      windowEnd: body.windowEnd,
      dryRun: body.dryRun,
    };
    const run = await start(briefWorkflow, [input]);
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

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = Math.max(
      1,
      Math.min(Number(url.searchParams.get("limit") ?? "20"), 100)
    );
    const kind = url.searchParams.get("kind");
    const sql = getSql();
    const rows = await sql /* sql */`
      select id, date, kind, status, summary, run_id, job_id, error_text,
             created_at, updated_at, completed_at
      from briefs
      ${kind ? sql`where kind = ${kind}` : sql``}
      order by created_at desc
      limit ${limit}
    `;
    return NextResponse.json({ briefs: rows });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "list failed" },
      { status: 500 }
    );
  }
}
