/**
 * /briefs/[id] — single brief as a structured hero REPORT.
 *
 * Server component (direct Postgres, force-dynamic). Parses the
 * `briefs.insights` jsonb (the ENTIRE BriefOutput) and `briefs.source_context`
 * jsonb, then composes: header + per-brief hero tiles, the StructuredBriefReport
 * (insights / next actions / questions), the "What drove this brief" source
 * context panel, prior replies + the reply form, and a collapsed
 * "View raw report" fallback rendered with the existing Markdown component.
 *
 * Replaces the old zinc/emerald palette with the rebuilt design tokens.
 */

import { ArrowLeft, Clock, FileText, MessageSquare } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import postgres from "postgres";
import { BriefReplyForm } from "@/components/tars/brief-reply-form";
import { StructuredBriefReport } from "@/components/tars/brief-report";
import { BriefSourceContext } from "@/components/tars/brief-source-context";
import {
  type BriefHeroStats,
  BriefHeroTiles,
} from "@/components/tars/brief-stat-tiles";
import {
  composeLatency,
  kindLabel,
  parseBriefOutput,
  parseSourceContext,
} from "@/components/tars/brief-types";
import { Markdown } from "@/components/tars/markdown";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

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

interface ReplyRow {
  id: string;
  body: string;
  chat_session_id: string | null;
  created_at: string;
}

async function loadBrief(
  id: string
): Promise<{ brief: BriefRow; replies: ReplyRow[] } | null> {
  if (!UUID_RE.test(id)) {
    return null;
  }
  try {
    const sql = getSql();
    const rows = await sql /* sql */`
      select id::text as id, to_char(date, 'YYYY-MM-DD') as date,
             kind, status, summary, body_markdown, insights, source_context,
             run_id, error_text,
             to_char(created_at, 'YYYY-MM-DD HH24:MI UTC') as created_at,
             to_char(completed_at, 'YYYY-MM-DD HH24:MI UTC') as completed_at
      from briefs
      where id = ${id}::uuid
      limit 1
    `;
    if (rows.length === 0) {
      return null;
    }
    const replyRows = await sql /* sql */`
      select id::text as id, body, chat_session_id::text as chat_session_id,
             to_char(created_at, 'YYYY-MM-DD HH24:MI UTC') as created_at
      from brief_replies
      where brief_id = ${id}::uuid
      order by created_at asc
    `;
    return {
      brief: rows[0] as unknown as BriefRow,
      replies: replyRows as unknown as ReplyRow[],
    };
  } catch (err) {
    console.error("/briefs/[id] load failed", err);
    return null;
  }
}

function PriorReplies({ replies }: { replies: ReplyRow[] }) {
  if (replies.length === 0) {
    return null;
  }
  return (
    <details
      className="rounded-xl border bg-card/40 p-4"
      open={replies.length === 1}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-sm">
        <MessageSquare className="size-4 text-[#00d4a0]" />
        {replies.length} previous repl{replies.length === 1 ? "y" : "ies"}
      </summary>
      <ul className="mt-3 space-y-2">
        {replies.map((r) => (
          <li className="rounded-lg border bg-card p-3" key={r.id}>
            <p className="whitespace-pre-wrap text-foreground/90 text-sm">
              {r.body}
            </p>
            <div className="mt-2 flex items-center justify-between text-muted-foreground text-xs">
              <span>{r.created_at}</span>
              {r.chat_session_id ? (
                <Link
                  className="transition-colors hover:text-[#00d4a0]"
                  href={`/chat?session=${encodeURIComponent(r.chat_session_id)}`}
                >
                  Open thread →
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}

export default async function BriefDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const loaded = await loadBrief(id);
  if (!loaded) {
    return notFound();
  }
  const { brief, replies } = loaded;
  const out = parseBriefOutput(brief.insights);
  const ctx = parseSourceContext(brief.source_context);
  const isReady = brief.status === "ready";

  const heroStats: BriefHeroStats = {
    latestLabel: kindLabel(brief.kind),
    latestSub: brief.date,
    shaunActions: out.next_actions.filter((a) => a.owner === "shaun").length,
    actInsights: out.insights.filter((i) => i.severity === "act").length,
    questions: out.questions.length,
    openPrs: ctx.open_prs?.length ?? 0,
    composeLatency: isReady
      ? composeLatency(brief.created_at, brief.completed_at)
      : null,
  };

  const rawReport = brief.body_markdown ?? out.body_markdown;
  const hasStructured =
    out.insights.length > 0 ||
    out.next_actions.length > 0 ||
    out.questions.length > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <nav className="text-muted-foreground text-sm">
        <Link
          className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
          href="/briefs"
        >
          <ArrowLeft className="size-4" /> All briefs
        </Link>
      </nav>

      <header>
        <h1 className="flex items-center gap-2 font-semibold text-xl">
          <FileText className="size-5 text-[#00d4a0]" />
          {kindLabel(brief.kind)} brief — {brief.date}
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
          <span className="font-mono">run {brief.run_id}</span>
          {brief.completed_at ? (
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" /> completed {brief.completed_at}
            </span>
          ) : (
            <span>status {brief.status}</span>
          )}
        </p>
      </header>

      {isReady ? (
        <>
          <BriefHeroTiles stats={heroStats} />

          <section className="scroll-mt-20" id="latest-brief">
            {hasStructured ? (
              <StructuredBriefReport
                insights={out.insights}
                nextActions={out.next_actions}
                questions={out.questions}
                summary={out.summary}
              />
            ) : (
              <article className="brief-md rounded-xl border bg-card p-5">
                <Markdown text={rawReport || "(empty report)"} />
              </article>
            )}
          </section>

          <BriefSourceContext ctx={ctx} />

          {hasStructured && rawReport ? (
            <details className="rounded-xl border bg-card/40 p-4">
              <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-sm">
                <FileText className="size-4 text-muted-foreground" /> View raw
                report
              </summary>
              <article className="brief-md mt-4 border-foreground/10 border-t pt-4">
                <Markdown text={rawReport} />
              </article>
            </details>
          ) : null}
        </>
      ) : (
        <div className="rounded-xl border bg-card p-6 text-sm">
          <p className="mb-2 text-foreground/90">
            Status:{" "}
            <span className="font-semibold uppercase">{brief.status}</span>
          </p>
          {brief.error_text ? (
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-black/40 p-3 text-red-400 text-xs">
              {brief.error_text}
            </pre>
          ) : (
            <p className="text-muted-foreground">
              The compose job is still in flight. Refresh in a few seconds.
            </p>
          )}
        </div>
      )}

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 font-semibold text-base">
          <MessageSquare className="size-4 text-[#00d4a0]" /> Reply to TARS
        </h2>
        <p className="text-muted-foreground text-sm">
          Threads this brief into a chat session with its context attached.
        </p>
        <PriorReplies replies={replies} />
        <BriefReplyForm briefId={brief.id} />
      </section>
    </div>
  );
}
