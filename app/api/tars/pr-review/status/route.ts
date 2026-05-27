/**
 * API route: GET /api/tars/pr-review/status?runId=...&owner=...&repo=...&prNumber=...
 *
 * Polls the pr_review_runs table for the latest run matching (owner, repo,
 * prNumber). Returns the row as-is.
 *
 * INSTALL: copy to app/api/tars/pr-review/status/route.ts.
 */

import { NextResponse } from "next/server";
import postgres from "postgres";

let sqlClient: ReturnType<typeof postgres> | null = null;
function getSql() {
  if (sqlClient) {
    return sqlClient;
  }
  const url =
    process.env.WORKFLOW_POSTGRES_URL ??
    process.env.DATABASE_URL ??
    "postgres://tars_app:5bb16db4a6db588a087139b7225537595c0140791c0a037a@127.0.0.1:5433/tars_app";
  sqlClient = postgres(url, { max: 2, idle_timeout: 20, prepare: false });
  return sqlClient;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const owner = url.searchParams.get("owner");
  const repo = url.searchParams.get("repo");
  const prNumber = Number(url.searchParams.get("prNumber") ?? "0");
  if (!(owner && repo && prNumber)) {
    return NextResponse.json(
      { error: "owner, repo, prNumber required" },
      { status: 400 }
    );
  }
  try {
    const sql = getSql();
    const rows = await sql /* sql */`
      select run_id, owner, repo, pr_number, pr_sha, status, findings_count,
             review_comment_url, error, disagreed_payload, created_at, updated_at
      from pr_review_runs
      where owner=${owner} and repo=${repo} and pr_number=${prNumber}
      order by created_at desc
      limit 1
    `;
    if (rows.length === 0) {
      return NextResponse.json({ status: "not_found" }, { status: 404 });
    }
    return NextResponse.json(rows[0]);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "status query failed" },
      { status: 500 }
    );
  }
}
