/**
 * Shared chat runner used by both the streaming /api/chat route (UI clients)
 * and by inbound chat adapters (Slack, Linear). Adapters need a non-streaming
 * full-response so they can post one comment/message back; the UI route still
 * owns the streaming path directly.
 *
 * SOUL.md is loaded by the same logic, so persona + memory apply uniformly.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { and, eq } from "drizzle-orm";
import { db, migrationClient } from "@/lib/db";
import { chatMessages, chatSessions } from "@/lib/db/chat-schema";

let cachedSoulPrompt: string | undefined;

function getSoulPrompt(): string {
  if (cachedSoulPrompt !== undefined) {
    return cachedSoulPrompt;
  }
  try {
    cachedSoulPrompt = readFileSync(
      join(process.cwd(), "lib/tars/SOUL.md"),
      "utf-8"
    );
  } catch {
    cachedSoulPrompt = "You are TARS, a helpful AI assistant.";
  }
  return cachedSoulPrompt;
}

export async function ensureAnonUser(userId: string): Promise<void> {
  try {
    await migrationClient`
      INSERT INTO users (id, name, email, email_verified, is_anonymous, created_at, updated_at)
      VALUES (${userId}, 'Anonymous', NULL, false, true, now(), now())
      ON CONFLICT (id) DO NOTHING
    `;
  } catch {
    // ignore — table may differ in tests
  }
}

export interface RunChatTurnInput {
  userId: string;
  message: string;
  /** Existing chat session id to continue; if absent a new session is created. */
  sessionId?: string;
  /**
   * Free-form context injected ahead of the user message. Used by adapters to
   * thread Linear issue context / Slack thread context into the prompt without
   * polluting the persisted message body.
   */
  contextPrefix?: string;
  /** Optional title to set on the chat session on first turn. */
  titleHint?: string;
}

export interface RunChatTurnResult {
  sessionId: string;
  claudeSessionId: string | null;
  text: string;
  finishReason: string;
}

/**
 * Non-streaming chat turn. Persists user + assistant messages, then returns
 * the full assistant text once generation completes.
 */
export async function runChatTurn(
  input: RunChatTurnInput
): Promise<RunChatTurnResult> {
  const { userId, message, contextPrefix, titleHint } = input;
  if (!message?.trim()) {
    throw new Error("runChatTurn: empty message");
  }

  await ensureAnonUser(userId);

  let dbSessionId = input.sessionId;
  let claudeSessionId: string | null = null;
  let isNewSession = false;

  if (dbSessionId) {
    const existing = await db.query.chatSessions.findFirst({
      where: and(
        eq(chatSessions.id, dbSessionId),
        eq(chatSessions.userId, userId)
      ),
    });
    if (existing) {
      claudeSessionId = existing.claudeSessionId;
    } else {
      dbSessionId = undefined;
    }
  }

  if (!dbSessionId) {
    isNewSession = true;
    const inserted = await db
      .insert(chatSessions)
      .values({ userId })
      .returning({ id: chatSessions.id });
    dbSessionId = inserted[0].id;
  }

  await db.insert(chatMessages).values({
    sessionId: dbSessionId,
    role: "user",
    parts: [{ type: "text", text: message }],
    content: message,
  });

  const prompt = contextPrefix ? `${contextPrefix}\n\n${message}` : message;
  const soulPrompt = getSoulPrompt();

  const opts: Record<string, unknown> = {
    model: "claude-sonnet-4-6",
    systemPrompt: soulPrompt,
    allowedTools: [
      "Read",
      "Write",
      "Edit",
      "Bash",
      "Glob",
      "Grep",
      "WebFetch",
      "Task",
      "TodoRead",
      "TodoWrite",
    ],
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    cwd: "/home/shaun",
  };
  if (claudeSessionId) {
    opts.resume = claudeSessionId;
  }

  let fullText = "";
  let finishReason = "stop";
  const assistantParts: Record<string, unknown>[] = [];

  const q = query({
    prompt,
    options: opts as Parameters<typeof query>[0]["options"],
  });

  for await (const msg of q) {
    if (
      msg.type === "system" &&
      (msg as { subtype?: string }).subtype === "init"
    ) {
      const initMsg = msg as { session_id: string; subtype: string };
      const newClaudeSessionId = initMsg.session_id;
      if (!claudeSessionId && newClaudeSessionId) {
        await db
          .update(chatSessions)
          .set({ claudeSessionId: newClaudeSessionId })
          .where(eq(chatSessions.id, dbSessionId));
        claudeSessionId = newClaudeSessionId;
      }
      continue;
    }

    if (msg.type === "assistant") {
      const m = msg as {
        message: {
          content: Array<{
            type: string;
            text?: string;
            id?: string;
            name?: string;
            input?: unknown;
          }>;
        };
      };
      for (const block of m.message.content) {
        if (block.type === "text" && block.text) {
          assistantParts.push({ type: "text", text: block.text });
          fullText = block.text;
        } else if (block.type === "tool_use") {
          assistantParts.push({
            type: "tool-call",
            toolCallId: block.id,
            toolName: block.name,
            args: block.input,
          });
        }
      }
      continue;
    }

    if (msg.type === "result") {
      const m = msg as {
        subtype: string;
        stop_reason?: string;
        result?: string;
      };
      finishReason = m.stop_reason ?? "stop";
      if (m.result && !fullText) {
        fullText = m.result;
        assistantParts.push({ type: "text", text: m.result });
      }
      break;
    }
  }

  if (assistantParts.length > 0 || fullText) {
    const parts =
      assistantParts.length > 0
        ? assistantParts
        : [{ type: "text", text: fullText }];
    await db.insert(chatMessages).values({
      sessionId: dbSessionId,
      role: "assistant",
      parts,
      content: fullText,
    });
  }

  const updateData: Record<string, unknown> = { lastActiveAt: new Date() };
  if (isNewSession && (titleHint ?? message)) {
    const t = titleHint ?? message;
    updateData.title = t.length > 60 ? `${t.substring(0, 57)}...` : t;
  }
  await db
    .update(chatSessions)
    .set(updateData)
    .where(eq(chatSessions.id, dbSessionId));

  return {
    sessionId: dbSessionId,
    claudeSessionId,
    text: fullText,
    finishReason,
  };
}
