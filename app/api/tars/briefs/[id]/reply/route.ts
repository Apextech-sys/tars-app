/**
 * API: POST /api/tars/briefs/[id]/reply — capture Shaun's reply to a
 * brief, persist it, and thread it into a chat session by POSTing to
 * /api/chat with metadata `{ kind: "brief_reply", briefId }`.
 *
 * The chat endpoint owns conversation state; we just hand it the message
 * plus enough context for TARS to know which brief is being responded to.
 *
 * We deliberately do NOT call the chat endpoint server-to-server here —
 * the chat endpoint streams responses back to the client, so the client
 * (which renders /briefs/[id]) is the one that owns the call. This route
 * just persists the reply intent and returns the seed payload the client
 * should POST to /api/chat next.
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

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  let body: { message?: string; chatSessionId?: string | null };
  try {
    body = (await req.json()) as { message?: string; chatSessionId?: string };
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const message = (body.message ?? "").trim();
  if (!message) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }
  if (message.length > 10_000) {
    return NextResponse.json({ error: "message too long" }, { status: 400 });
  }

  try {
    const sql = getSql();
    const briefRows = await sql /* sql */`
      select id, summary, kind, to_char(date, 'YYYY-MM-DD') as date
      from briefs where id = ${id}::uuid limit 1
    `;
    if (briefRows.length === 0) {
      return NextResponse.json({ error: "brief not_found" }, { status: 404 });
    }
    const brief = briefRows[0] as {
      id: string;
      summary: string | null;
      kind: string;
      date: string;
    };
    const inserted = await sql /* sql */`
      insert into brief_replies (brief_id, chat_session_id, body)
      values (${brief.id}::uuid,
              ${body.chatSessionId ? sql`${body.chatSessionId}::uuid` : null},
              ${message})
      returning id, brief_id, chat_session_id, body, created_at
    `;
    const reply = inserted[0] as {
      id: string;
      brief_id: string;
      chat_session_id: string | null;
      body: string;
      created_at: string;
    };

    // Seed payload the client should POST to /api/chat.
    const chatSeed = {
      message: [
        `[brief_reply briefId=${brief.id} kind=${brief.kind} date=${brief.date}]`,
        brief.summary ? `Brief headline: ${brief.summary}` : "",
        "",
        message,
      ]
        .filter(Boolean)
        .join("\n"),
      sessionId: body.chatSessionId ?? undefined,
      metadata: {
        kind: "brief_reply",
        briefId: brief.id,
        briefReplyId: reply.id,
      },
    };

    return NextResponse.json({
      ok: true,
      reply,
      chatSeed,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "reply failed" },
      { status: 500 }
    );
  }
}
