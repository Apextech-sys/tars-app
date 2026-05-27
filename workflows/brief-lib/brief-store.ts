/**
 * brief-store — persistence steps for the brief workflow.
 *
 * Each function is "use step" so it runs in regular Node context with full
 * access to fs + postgres. The workflow side just calls them.
 *
 * The schema is owned by /home/shaun/tars-app/lib/db/migrations/0002_briefs.sql,
 * which lib/db/index.ts also registers via tars-schema.ts. We use the raw
 * `postgres` client here (not Drizzle) because that's how the rest of the
 * workflow lib accesses Postgres — see workflows/lib/audit.ts.
 */

import type { BriefKind, BriefOutput } from "../../lib/tars/brief/schema";

async function makeSql() {
  const postgres = (await import("postgres")).default;
  const url =
    process.env.WORKFLOW_POSTGRES_URL ??
    process.env.DATABASE_URL ??
    "postgres://tars_app:5bb16db4a6db588a087139b7225537595c0140791c0a037a@127.0.0.1:5433/tars_app";
  return postgres(url, { max: 2, idle_timeout: 20, prepare: false });
}

export interface InsertPendingBriefArgs {
  runId: string;
  date: string;
  kind: BriefKind;
  sourceContext: Record<string, unknown>;
}

/**
 * Reserve a row up-front with status='pending' so the dashboard can show
 * the brief as in-flight. The unique index on run_id makes this idempotent
 * for retry replays — the second call updates source_context only.
 */
export async function insertPendingBrief(
  args: InsertPendingBriefArgs
): Promise<{ briefId: string }> {
  "use step";
  const sql = await makeSql();
  try {
    const rows = await sql /* sql */`
      insert into briefs (run_id, date, kind, status, source_context)
      values (
        ${args.runId},
        ${args.date},
        ${args.kind},
        'pending',
        ${sql.json(args.sourceContext as any)}
      )
      on conflict (run_id) do update set
        source_context = excluded.source_context,
        updated_at = now()
      returning id
    `;
    const id = (rows[0] as { id: string }).id;
    return { briefId: id };
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

export interface UpdateBriefStatusArgs {
  runId: string;
  status: "pending" | "composing" | "ready" | "failed";
  jobId?: string | null;
  errorText?: string | null;
}

export async function updateBriefStatus(
  args: UpdateBriefStatusArgs
): Promise<void> {
  "use step";
  const sql = await makeSql();
  try {
    await sql /* sql */`
      update briefs set
        status = ${args.status},
        job_id = coalesce(${args.jobId ?? null}, job_id),
        error_text = ${args.errorText ?? null},
        updated_at = now()
      where run_id = ${args.runId}
    `;
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

export interface FinalizeBriefArgs {
  runId: string;
  summary: string;
  bodyMarkdown: string;
  output: BriefOutput;
}

export async function finalizeBrief(args: FinalizeBriefArgs): Promise<void> {
  "use step";
  const sql = await makeSql();
  try {
    await sql /* sql */`
      update briefs set
        status        = 'ready',
        summary       = ${args.summary},
        body_markdown = ${args.bodyMarkdown},
        insights      = ${sql.json(args.output as any)},
        updated_at    = now(),
        completed_at  = now(),
        error_text    = null
      where run_id = ${args.runId}
    `;
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

export interface MirrorBriefToDiskArgs {
  date: string;
  kind: BriefKind;
  bodyMarkdown: string;
  runId: string;
}

/**
 * Mirror the rendered brief to disk so it sits next to Hermes' existing
 * briefings. We deliberately use a separate filename pattern (tars-)
 * so Shaun can diff the two in parallel during the cutover window.
 */
export async function mirrorBriefToDisk(
  args: MirrorBriefToDiskArgs
): Promise<{ path: string }> {
  "use step";
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const dir =
    process.env.TARS_BRIEFS_DIR ?? "/home/shaun/.tars-state/briefings";
  await fs.mkdir(dir, { recursive: true });
  const now = new Date();
  const hhmm = `${String(now.getUTCHours()).padStart(2, "0")}${String(
    now.getUTCMinutes()
  ).padStart(2, "0")}`;
  const file = path.join(dir, `${args.date}-${hhmm}-tars-${args.kind}.md`);
  await fs.writeFile(file, args.bodyMarkdown, "utf8");
  return { path: file };
}
