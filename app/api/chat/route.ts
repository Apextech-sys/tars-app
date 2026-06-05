export const runtime = "nodejs";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, migrationClient } from "@/lib/db";
import { chatMessages, chatSessions } from "@/lib/db/chat-schema";
import { getChatModel } from "@/lib/tars/model-config";

// Cache SOUL.md at module load time
let soulPrompt: string;
try {
  soulPrompt = readFileSync(join(process.cwd(), "lib/tars/SOUL.md"), "utf-8");
} catch {
  soulPrompt = "You are TARS, a helpful AI assistant.";
}

// Normalize a tool_result content block (string | array of text blocks |
// other) into a plain string, preserving the original branching behavior.
function toolResultToString(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return (content as Array<{ type: string; text: string }>)
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
  }
  return String(content ?? "");
}

async function ensureAnonUser(userId: string) {
  try {
    // Use the postgres client directly for raw upsert
    await migrationClient`
      INSERT INTO users (id, name, email, email_verified, is_anonymous, created_at, updated_at)
      VALUES (${userId}, 'Anonymous', NULL, false, true, now(), now())
      ON CONFLICT (id) DO NOTHING
    `;
  } catch {
    // ignore - user may already exist or table structure differs
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: breadth-heavy chat handler (session resolution + SSE streaming of multiple SDK message kinds); decomposing risks altering request/stream behavior.
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    sessionId?: string;
    message: string;
    metadata?: { kind?: string; briefId?: string; briefReplyId?: string };
  };
  const { sessionId, message, metadata } = body;

  if (!message?.trim()) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }

  // Get user ID (Better Auth session or anon fallback)
  let userId = "anon-tars-single-user";
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (session?.user?.id) {
      userId = session.user.id;
    }
  } catch {
    // use anon
  }

  await ensureAnonUser(userId);

  // Load or create DB session
  let dbSessionId = sessionId;
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

  // From here on dbSessionId is guaranteed to be a string. Use a
  // non-optional alias so downstream code (incl. the stream closure)
  // has a narrowed type without non-null assertions.
  const resolvedSessionId: string = dbSessionId;

  // Build user-message parts. When a brief_reply metadata marker is
  // attached we record it alongside the text so the conversation history
  // shows what brief was being responded to. We also link the chat
  // session back into brief_replies so /briefs/[id] can find the thread.
  const userParts: unknown[] =
    metadata && metadata.kind === "brief_reply" && metadata.briefId
      ? [
          { type: "text", text: message },
          {
            type: "brief-reply",
            briefId: metadata.briefId,
            briefReplyId: metadata.briefReplyId ?? null,
          },
        ]
      : [{ type: "text", text: message }];

  await db.insert(chatMessages).values({
    sessionId: dbSessionId,
    role: "user",
    parts: userParts,
    content: message,
  });

  // Link the chat session into brief_replies so the brief view can show
  // "this brief threaded into chat session X". Failure is non-fatal.
  if (metadata && metadata.kind === "brief_reply" && metadata.briefReplyId) {
    try {
      await migrationClient.unsafe(
        "UPDATE brief_replies SET chat_session_id = $1::uuid WHERE id = $2::uuid",
        [resolvedSessionId, metadata.briefReplyId]
      );
    } catch (err) {
      console.warn("[chat] brief_replies link failed", err);
    }
  }

  const chatModel = await getChatModel();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: SSE producer fans out over many distinct SDK message types (system/stream_event/assistant/user/result); the branch breadth is intrinsic and splitting it risks the streaming contract.
    async start(controller) {
      const send = (code: string, value: unknown) => {
        controller.enqueue(
          encoder.encode(`${code}:${JSON.stringify(value)}\n`)
        );
      };

      // Send session metadata immediately
      send("d", { sessionId: dbSessionId });

      const assistantParts: unknown[] = [];
      let fullText = "";

      try {
        const opts: Record<string, unknown> = {
          model: chatModel,
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
          includePartialMessages: true,
          cwd: "/home/shaun",
        };

        if (claudeSessionId) {
          opts.resume = claudeSessionId;
        }

        const q = query({
          prompt: message,
          options: opts as Parameters<typeof query>[0]["options"],
        });

        for await (const msg of q) {
          // Capture session ID from init message
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
                .where(eq(chatSessions.id, resolvedSessionId));
            }
            send("d", {
              sessionId: dbSessionId,
              claudeSessionId: newClaudeSessionId ?? claudeSessionId,
            });
            continue;
          }

          // Stream partial text tokens
          if (msg.type === "stream_event") {
            const ev = (
              msg as unknown as {
                event: {
                  type: string;
                  delta?: { type: string; text: string };
                };
              }
            ).event;
            if (
              ev.type === "content_block_delta" &&
              ev.delta?.type === "text_delta"
            ) {
              send("0", ev.delta.text);
              fullText += ev.delta.text;
            }
            continue;
          }

          // Full assistant message (includes tool_use blocks)
          if (msg.type === "assistant") {
            for (const block of msg.message.content) {
              if (block.type === "text" && block.text) {
                assistantParts.push({ type: "text", text: block.text });
                if (!fullText) {
                  fullText = block.text;
                }
              } else if (block.type === "tool_use") {
                const toolPart = {
                  type: "tool-call",
                  toolCallId: block.id,
                  toolName: block.name,
                  args: block.input,
                };
                assistantParts.push(toolPart);
                send("9", {
                  toolCallId: block.id,
                  toolName: block.name,
                  args: block.input,
                });
              }
            }
            continue;
          }

          // Tool results come back as user messages from SDK
          if (msg.type === "user") {
            const content = (
              msg as unknown as { message?: { content: unknown[] } }
            ).message?.content;
            if (Array.isArray(content)) {
              for (const block of content as Array<{
                type: string;
                tool_use_id: string;
                content: unknown;
              }>) {
                if (block.type === "tool_result") {
                  const resultText = toolResultToString(block.content);
                  send("a", {
                    toolCallId: block.tool_use_id,
                    result: resultText.slice(0, 4000),
                  });
                  assistantParts.push({
                    type: "tool-result",
                    toolCallId: block.tool_use_id,
                    result: resultText,
                  });
                }
              }
            }
            continue;
          }

          // Result message = stream complete
          if (msg.type === "result") {
            if ((msg as unknown as { subtype: string }).subtype === "success") {
              const usageMsg = msg as unknown as {
                usage?: { input_tokens: number; output_tokens: number };
                stop_reason?: string;
              };
              send("d", {
                finishReason: usageMsg.stop_reason ?? "stop",
                usage: {
                  promptTokens: usageMsg.usage?.input_tokens ?? 0,
                  completionTokens: usageMsg.usage?.output_tokens ?? 0,
                },
              });
            } else {
              send("3", "Generation failed");
            }
            break;
          }
        }

        // Persist assistant message
        if (assistantParts.length > 0 || fullText) {
          const parts =
            assistantParts.length > 0
              ? assistantParts
              : [{ type: "text", text: fullText }];
          await db.insert(chatMessages).values({
            sessionId: resolvedSessionId,
            role: "assistant",
            parts,
            content: fullText,
          });
        }

        // Update session metadata
        const updateData: Record<string, unknown> = {
          lastActiveAt: new Date(),
        };
        if (isNewSession && message) {
          updateData.title =
            message.length > 60 ? `${message.slice(0, 57)}...` : message;
        }
        await db
          .update(chatSessions)
          .set(updateData)
          .where(eq(chatSessions.id, resolvedSessionId));
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        send("3", errMsg);
        console.error("[chat/route] error:", err);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Vercel-AI-Data-Stream": "v1",
      "Cache-Control": "no-cache, no-transform",
      "x-session-id": dbSessionId ?? "",
    },
  });
}
