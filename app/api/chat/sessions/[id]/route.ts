export const runtime = "nodejs";

import { and, asc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { chatMessages, chatSessions } from "@/lib/db/chat-schema";

async function getUserId(req: NextRequest): Promise<string> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (session?.user?.id) {
      return session.user.id;
    }
  } catch {
    // fall through
  }
  return req.cookies.get("tars_anon_id")?.value ?? "anon-tars-single-user";
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = await getUserId(req);

  const session = await db.query.chatSessions.findFirst({
    where: and(eq(chatSessions.id, id), eq(chatSessions.userId, userId)),
  });

  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const messages = await db.query.chatMessages.findMany({
    where: eq(chatMessages.sessionId, id),
    orderBy: asc(chatMessages.createdAt),
  });

  return NextResponse.json({ session, messages });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userId = await getUserId(req);

  await db
    .update(chatSessions)
    .set({ archived: true })
    .where(and(eq(chatSessions.id, id), eq(chatSessions.userId, userId)));

  return NextResponse.json({ success: true });
}
