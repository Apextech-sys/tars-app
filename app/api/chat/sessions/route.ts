export const runtime = "nodejs";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chatSessions, chatMessages } from "@/lib/db/chat-schema";
import { eq, and, desc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

async function getUserId(req: NextRequest): Promise<string> {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (session?.user?.id) return session.user.id;
  } catch {
    // fall through
  }
  // Anon user from cookie
  const anonId =
    req.cookies.get("tars_anon_id")?.value ?? "anon-tars-single-user";
  return anonId;
}

export async function GET(req: NextRequest) {
  const userId = await getUserId(req);

  const sessions = await db.query.chatSessions.findMany({
    where: and(
      eq(chatSessions.userId, userId),
      eq(chatSessions.archived, false)
    ),
    orderBy: desc(chatSessions.lastActiveAt),
    limit: 50,
  });

  return NextResponse.json({ sessions });
}
