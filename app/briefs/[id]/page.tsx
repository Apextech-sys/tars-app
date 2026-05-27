/**
 * /briefs/[id] — single brief detail view + reply form.
 *
 * The detail server-renders the brief and embeds the BriefReplyForm
 * client component. The reply form (a) POSTs to
 * /api/tars/briefs/[id]/reply to persist the reply, then (b) takes the
 * returned chatSeed and POSTs it to /api/chat — which threads the brief
 * context into a chat session and streams TARS's response back.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import postgres from "postgres";

import { Markdown } from "@/components/tars/markdown";
import { BriefReplyForm } from "@/components/tars/brief-reply-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let sqlClient: ReturnType<typeof postgres> | null = null;
function getSql() {
  if (sqlClient) return sqlClient;
  const url =
    process.env.WORKFLOW_POSTGRES_URL ??
    process.env.DATABASE_URL ??
    "postgres://tars_app:5bb16db4a6db588a087139b7225537595c0140791c0a037a@127.0.0.1:5433/tars_app";
  sqlClient = postgres(url, { max: 4, idle_timeout: 20, prepare: false });
  return sqlClient;
}

interface BriefRow {
  id: string;
  date: string;
  kind: "morning" | "evening" | "adhoc";
  status: "pending" | "composing" | "ready" | "failed";
  summary: string | null;
  body_markdown: string | null;
  insights: unknown;
  source_context: unknown;
  run_id: string;
  error_text: string | null;
  created_at: string;
  completed_at: string | null;
}

async function loadBrief(id: string): Promise<BriefRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  try {
    const sql = getSql();
    const rows = await sql/* sql */`
      select id::text as id, to_char(date, 'YYYY-MM-DD') as date,
             kind, status, summary, body_markdown, insights, source_context,
             run_id, error_text,
             to_char(created_at, 'YYYY-MM-DD HH24:MI UTC') as created_at,
             to_char(completed_at, 'YYYY-MM-DD HH24:MI UTC') as completed_at
      from briefs
      where id = ${id}::uuid
      limit 1
    `;
    if (rows.length === 0) return null;
    return rows[0] as unknown as BriefRow;
  } catch (err) {
    console.error("/briefs/[id] load failed", err);
    return null;
  }
}

export default async function BriefDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const brief = await loadBrief(id);
  if (!brief) return notFound();

  const kindLabel =
    brief.kind === "morning"
      ? "Morning Brief"
      : brief.kind === "evening"
        ? "Evening Brief"
        : "Adhoc Brief";

  return (
    <div className="pointer-events-auto min-h-screen w-full text-zinc-100 px-6 py-10">
      <div className="max-w-3xl mx-auto">
        <nav className="text-sm text-zinc-500 mb-6">
          <Link href="/briefs" className="hover:text-zinc-300">
            ← All briefs
          </Link>
        </nav>

        <header className="mb-6">
          <h1 className="text-3xl font-semibold tracking-tight">
            {kindLabel} — {brief.date}
          </h1>
          <p className="text-xs text-zinc-500 mt-2">
            run_id <code className="text-zinc-400">{brief.run_id}</code>
            {brief.completed_at ? ` · completed ${brief.completed_at}` : ""}
            {!brief.completed_at && brief.status !== "ready"
              ? ` · status ${brief.status}`
              : ""}
          </p>
        </header>

        {brief.status !== "ready" ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-6 text-sm">
            <p className="text-zinc-300 mb-2">
              Status:{" "}
              <span className="font-semibold uppercase">{brief.status}</span>
            </p>
            {brief.error_text ? (
              <pre className="text-xs text-rose-300 bg-black/40 p-3 rounded mt-2 overflow-x-auto">
                {brief.error_text}
              </pre>
            ) : (
              <p className="text-zinc-400">
                The compose job is still in flight. Refresh in a few seconds.
              </p>
            )}
          </div>
        ) : (
          <article className="prose-tars">
            <Markdown text={brief.body_markdown ?? "(empty)"} />
          </article>
        )}

        <section className="mt-10">
          <h2 className="text-xl font-semibold mb-3 text-zinc-100">
            Reply to TARS
          </h2>
          <p className="text-sm text-zinc-400 mb-4">
            Threads this brief into a new chat session with context attached.
          </p>
          <BriefReplyForm briefId={brief.id} />
        </section>
      </div>
    </div>
  );
}
