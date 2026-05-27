/**
 * API: GET /api/tars/briefs/[id] — fetch one brief by UUID.
 */

import { NextResponse } from "next/server";
import postgres from "postgres";

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

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  try {
    const sql = getSql();
    const rows = await sql /* sql */`
      select id, date, kind, status, summary, body_markdown, insights,
             source_context, run_id, job_id, error_text,
             created_at, updated_at, completed_at
      from briefs
      where id = ${id}::uuid
      limit 1
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json(rows[0]);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "query failed" },
      { status: 500 }
    );
  }
}
