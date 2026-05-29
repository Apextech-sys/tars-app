"use client";

import {
  AlertCircle,
  ChevronRight,
  X as CloseIcon,
  Cpu,
  FileText,
  Globe,
  Loader2,
  Menu,
  MessageSquare,
  Plus,
  Send,
  Terminal,
  Trash2,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

interface ChatSession {
  id: string;
  title: string | null;
  createdAt: string;
  lastActiveAt: string;
  claudeSessionId: string | null;
}

interface MessagePart {
  type: "text" | "tool-call" | "tool-result";
  text?: string;
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  result?: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  parts: MessagePart[];
  content?: string;
  createdAt: string;
}

interface StreamingMessage {
  role: "assistant";
  parts: MessagePart[];
  isStreaming: boolean;
}

// ──────────────────────────────────────────────────────────────
// Tool-call icon map
// ──────────────────────────────────────────────────────────────

function ToolIcon({ name }: { name: string }) {
  const n = name.toLowerCase();
  if (n === "bash" || n === "computer") {
    return <Terminal className="h-3.5 w-3.5" />;
  }
  if (n === "read" || n === "write" || n === "edit" || n === "glob") {
    return <FileText className="h-3.5 w-3.5" />;
  }
  if (n === "webfetch" || n === "websearch") {
    return <Globe className="h-3.5 w-3.5" />;
  }
  return <Cpu className="h-3.5 w-3.5" />;
}

// ──────────────────────────────────────────────────────────────
// ToolCallBlock
// ──────────────────────────────────────────────────────────────

function ToolCallBlock({
  part,
  result,
}: {
  part: MessagePart;
  result?: MessagePart;
}) {
  const [open, setOpen] = useState(false);
  const argsStr = JSON.stringify(part.args ?? {}, null, 2);
  const resultStr = result?.result ?? "";

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-white/10 bg-black/20 text-xs">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/5"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <span className="text-[#00d4a0]">
          <ToolIcon name={part.toolName ?? ""} />
        </span>
        <span className="font-medium font-mono text-[#00d4a0]">
          {part.toolName}
        </span>
        <span className="ml-auto text-white/30">
          {resultStr ? "completed" : "running..."}
        </span>
        <ChevronRight
          className={cn(
            "h-3 w-3 text-white/30 transition-transform",
            open && "rotate-90"
          )}
        />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            animate={{ height: "auto", opacity: 1 }}
            className="overflow-hidden"
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <div className="space-y-2 border-white/10 border-t px-3 py-2">
              {argsStr !== "{}" && (
                <div>
                  <div className="mb-1 text-[10px] text-white/40 uppercase tracking-wider">
                    Input
                  </div>
                  <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[11px] text-white/70">
                    {argsStr}
                  </pre>
                </div>
              )}
              {resultStr && (
                <div>
                  <div className="mb-1 text-[10px] text-white/40 uppercase tracking-wider">
                    Output
                  </div>
                  <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[11px] text-white/70">
                    {resultStr}
                  </pre>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// MessageBubble
// ──────────────────────────────────────────────────────────────

function MessageBubble({
  role,
  parts,
  isStreaming,
}: {
  role: "user" | "assistant";
  parts: MessagePart[];
  isStreaming?: boolean;
}) {
  const isUser = role === "user";

  // Build tool-call → result map
  const toolResults = new Map<string, MessagePart>();
  for (const p of parts) {
    if (p.type === "tool-result" && p.toolCallId) {
      toolResults.set(p.toolCallId, p);
    }
  }

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "flex max-w-full gap-3",
        isUser ? "justify-end" : "justify-start"
      )}
      initial={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.2 }}
    >
      {!isUser && (
        <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-[#00d4a0]/40 bg-[#00d4a0]/20">
          <span className="font-bold text-[#00d4a0] text-[10px]">T</span>
        </div>
      )}

      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
          isUser
            ? "ml-auto border border-[#00d4a0]/30 bg-[#00d4a0]/20 text-white"
            : "border border-white/10 bg-white/5 text-white/90"
        )}
      >
        {parts.map((part, i) => {
          if (part.type === "text" && part.text) {
            return (
              <div
                className="whitespace-pre-wrap"
                key={`text-${part.toolCallId ?? ""}-${i}`}
              >
                {part.text}
              </div>
            );
          }
          if (part.type === "tool-call") {
            return (
              <ToolCallBlock
                key={`tool-${part.toolCallId ?? i}`}
                part={part}
                result={
                  part.toolCallId ? toolResults.get(part.toolCallId) : undefined
                }
              />
            );
          }
          return null;
        })}
        {isStreaming && (
          <span className="ml-1 inline-flex items-center gap-1">
            <span className="h-3 w-1 animate-pulse rounded-sm bg-[#00d4a0]" />
          </span>
        )}
      </div>
    </motion.div>
  );
}

// ──────────────────────────────────────────────────────────────
// SessionSidebar
// ──────────────────────────────────────────────────────────────

function SessionSidebar({
  sessions,
  activeId,
  onSelect,
  onNew,
  onDelete,
  loading,
}: {
  sessions: ChatSession[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  loading: boolean;
}) {
  return (
    <div className="flex h-full w-64 flex-shrink-0 flex-col border-white/10 border-r bg-black/30 backdrop-blur-sm">
      <div className="flex items-center justify-between border-white/10 border-b p-4">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-[#00d4a0]" />
          <span className="font-semibold text-sm text-white">TARS Chat</span>
        </div>
        <Button
          className="h-7 w-7 p-0 hover:bg-[#00d4a0]/20 hover:text-[#00d4a0]"
          onClick={onNew}
          size="sm"
          title="New conversation"
          variant="ghost"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex items-center justify-center p-4">
            <Loader2 className="h-4 w-4 animate-spin text-white/40" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="p-4 text-center text-white/30 text-xs">
            No conversations yet
          </div>
        ) : (
          sessions.map((s) => (
            <button
              className={cn(
                "group flex w-full items-start justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-xs transition-all",
                activeId === s.id
                  ? "border border-[#00d4a0]/30 bg-[#00d4a0]/15 text-white"
                  : "border border-transparent text-white/60 hover:bg-white/5 hover:text-white/90"
              )}
              key={s.id}
              onClick={() => onSelect(s.id)}
              type="button"
            >
              <span className="flex-1 truncate">
                {s.title ?? "New conversation"}
              </span>
              <button
                className="mt-0.5 flex-shrink-0 text-white/30 opacity-0 transition-all hover:text-red-400 group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(s.id);
                }}
                title="Archive"
                type="button"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// PromptInput
// ──────────────────────────────────────────────────────────────

function PromptInput({
  onSend,
  disabled,
}: {
  onSend: (msg: string) => void;
  disabled: boolean;
}) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    if (!value.trim() || disabled) {
      return;
    }
    onSend(value.trim());
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  return (
    <div className="relative rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm transition-colors focus-within:border-[#00d4a0]/50">
      <textarea
        className="max-h-[200px] w-full resize-none bg-transparent px-4 py-3 pr-12 text-sm text-white placeholder:text-white/30 focus:outline-none disabled:opacity-50"
        disabled={disabled}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        placeholder="Message TARS... (Enter to send, Shift+Enter for newline)"
        ref={textareaRef}
        rows={1}
        style={{ fontSize: "16px" }}
        value={value}
      />
      <button
        className="absolute right-3 bottom-3 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-[#00d4a0]/20 p-2 text-[#00d4a0] transition-all hover:bg-[#00d4a0]/40 disabled:cursor-not-allowed disabled:opacity-30"
        disabled={disabled || !value.trim()}
        onClick={handleSend}
        type="button"
      >
        {disabled ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Send className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Main ChatPage
// ──────────────────────────────────────────────────────────────

export default function ChatPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState<StreamingMessage | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages update
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streaming, scrollToBottom]);

  // Load sessions on mount
  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const res = await fetch("/api/chat/sessions");
      if (res.ok) {
        const data = (await res.json()) as { sessions: ChatSession[] };
        setSessions(data.sessions ?? []);
      }
    } catch {
      // ignore
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Load session messages
  const loadSession = useCallback(async (id: string) => {
    setActiveSessionId(id);
    setMessages([]);
    setStreaming(null);
    setError(null);
    try {
      const res = await fetch(`/api/chat/sessions/${id}`);
      if (res.ok) {
        const data = (await res.json()) as {
          session: ChatSession;
          messages: ChatMessage[];
        };
        setMessages(data.messages ?? []);
      }
    } catch {
      setError("Failed to load session");
    }
  }, []);

  const startNewChat = () => {
    setActiveSessionId(null);
    setMessages([]);
    setStreaming(null);
    setError(null);
  };

  const deleteSession = async (id: string) => {
    await fetch(`/api/chat/sessions/${id}`, { method: "DELETE" });
    if (activeSessionId === id) {
      startNewChat();
    }
    setSessions((prev) => prev.filter((s) => s.id !== id));
  };

  const sendMessage = async (text: string) => {
    if (isLoading) {
      return;
    }
    setIsLoading(true);
    setError(null);

    // Add user message optimistically
    const optimisticMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text }],
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMsg]);

    // Start streaming assistant message
    const streamMsg: StreamingMessage = {
      role: "assistant",
      parts: [],
      isStreaming: true,
    };
    setStreaming(streamMsg);

    let currentSessionId = activeSessionId;
    let fullText = "";
    // currentParts mirrors setStreaming's parts array in the local closure so
    // the finally block can read the final accumulated parts without going
    // through React state (which is async and would return stale data).
    let currentParts: MessagePart[] = [];
    const toolCallsMap = new Map<string, MessagePart>();
    const toolResultsMap = new Map<string, MessagePart>();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: currentSessionId,
          message: text,
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const newSessionId = res.headers.get("x-session-id");
      if (newSessionId) {
        currentSessionId = newSessionId;
        setActiveSessionId(newSessionId);
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error("No stream body");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }
          const colonIdx = line.indexOf(":");
          if (colonIdx === -1) {
            continue;
          }

          const code = line.slice(0, colonIdx);
          const jsonStr = line.slice(colonIdx + 1);

          let parsed: unknown;
          try {
            parsed = JSON.parse(jsonStr);
          } catch {
            continue;
          }

          if (code === "0") {
            // text delta
            fullText += parsed as string;
            // Update local tracking
            const existingTextIdx = currentParts.findIndex(
              (p) => p.type === "text"
            );
            if (existingTextIdx >= 0) {
              currentParts = currentParts.map((p, i) =>
                i === existingTextIdx ? { ...p, text: fullText } : p
              );
            } else {
              currentParts = [
                ...currentParts,
                { type: "text", text: fullText },
              ];
            }
            setStreaming((prev) => {
              if (!prev) {
                return prev;
              }
              const textParts = prev.parts.filter((p) => p.type !== "text");
              return {
                ...prev,
                parts: [...textParts, { type: "text", text: fullText }],
              };
            });
          } else if (code === "9") {
            // tool call
            const tc = parsed as {
              toolCallId: string;
              toolName: string;
              args: Record<string, unknown>;
            };
            const toolPart: MessagePart = {
              type: "tool-call",
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              args: tc.args,
            };
            toolCallsMap.set(tc.toolCallId, toolPart);
            currentParts = [
              ...currentParts.filter(
                (p) => p.type !== "tool-call" || p.toolCallId !== tc.toolCallId
              ),
              toolPart,
            ];
            setStreaming((prev) => {
              if (!prev) {
                return prev;
              }
              const filtered = prev.parts.filter(
                (p) => p.type !== "tool-call" || p.toolCallId !== tc.toolCallId
              );
              return { ...prev, parts: [...filtered, toolPart] };
            });
          } else if (code === "a") {
            // tool result
            const tr = parsed as { toolCallId: string; result: string };
            const resultPart: MessagePart = {
              type: "tool-result",
              toolCallId: tr.toolCallId,
              result: tr.result,
            };
            toolResultsMap.set(tr.toolCallId, resultPart);
            currentParts = [
              ...currentParts.filter(
                (p) =>
                  p.type !== "tool-result" || p.toolCallId !== tr.toolCallId
              ),
              resultPart,
            ];
            setStreaming((prev) => {
              if (!prev) {
                return prev;
              }
              const filtered = prev.parts.filter(
                (p) =>
                  p.type !== "tool-result" || p.toolCallId !== tr.toolCallId
              );
              return { ...prev, parts: [...filtered, resultPart] };
            });
          } else if (code === "d") {
            // metadata
            const meta = parsed as {
              sessionId?: string;
              claudeSessionId?: string;
              finishReason?: string;
            };
            if (meta.sessionId && !currentSessionId) {
              currentSessionId = meta.sessionId;
              setActiveSessionId(meta.sessionId);
            }
          } else if (code === "3") {
            // error
            setError(parsed as string);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stream error");
    } finally {
      // Commit streaming message to messages.
      // IMPORTANT: do NOT call setMessages inside a setStreaming updater —
      // calling a setter inside another setter's functional update is not
      // reliably batched in React and causes the message to silently drop.
      // Instead capture the streamed parts via the fullText closure (already
      // in scope) and build the final message here, then call both setters
      // separately so React sees them as two independent enqueued updates.
      const capturedText = fullText;
      // Use the locally tracked currentParts (kept in sync during streaming)
      // instead of reading React state (which is async/stale at this point).
      const finalParts: MessagePart[] =
        currentParts.length > 0
          ? currentParts
          : [{ type: "text", text: capturedText }];
      const finalMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        parts: finalParts,
        content: capturedText,
        createdAt: new Date().toISOString(),
      };
      setStreaming(null);
      setMessages((msgs) => [...msgs, finalMsg]);
      setIsLoading(false);

      // Refresh sessions list after first message
      await loadSessions();
    }
  };

  // Combine persisted + streaming messages for display
  const allMessages = messages;

  return (
    <div className="flex h-screen overflow-hidden bg-[#0a0f0d] text-white">
      {/* Mobile overlay backdrop */}
      {sidebarOpen && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      {/* Sidebar — drawer on mobile, static on desktop */}
      <div
        className={[
          "fixed inset-y-0 left-0 z-50 transition-transform duration-200 md:static md:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        <SessionSidebar
          activeId={activeSessionId}
          loading={sessionsLoading}
          onDelete={deleteSession}
          onNew={() => {
            startNewChat();
            setSidebarOpen(false);
          }}
          onSelect={(id) => {
            loadSession(id);
            setSidebarOpen(false);
          }}
          sessions={sessions}
        />
      </div>

      {/* Main chat area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <div className="flex flex-shrink-0 items-center gap-2 border-white/10 border-b bg-black/20 px-4 py-3 backdrop-blur-sm md:px-6">
          {/* Hamburger — mobile only */}
          <button
            aria-label="Open chat sessions"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/10 hover:text-white md:hidden"
            onClick={() => setSidebarOpen((v) => !v)}
            type="button"
          >
            {sidebarOpen ? (
              <CloseIcon className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[#00d4a0]" />
            <span className="truncate font-medium text-sm text-white/80">
              {activeSessionId
                ? (sessions.find((s) => s.id === activeSessionId)?.title ??
                  "Conversation")
                : "New conversation"}
            </span>
          </div>
          <div className="ml-auto shrink-0 font-mono text-white/30 text-xs">
            claude-sonnet-4-6 via SDK
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 md:px-6">
          {allMessages.length === 0 && !streaming && (
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="flex h-full flex-col items-center justify-center text-center"
              initial={{ opacity: 0, y: 20 }}
            >
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-[#00d4a0]/30 bg-[#00d4a0]/10">
                <span className="font-bold text-2xl text-[#00d4a0]">T</span>
              </div>
              <h2 className="mb-2 font-semibold text-white text-xl">
                TARS is ready
              </h2>
              <p className="max-w-sm text-sm text-white/40">
                Your personal operations AI. Ask about your infrastructure,
                projects, or anything else.
              </p>
            </motion.div>
          )}

          {allMessages.map((msg) => (
            <MessageBubble
              key={msg.id}
              parts={msg.parts as MessagePart[]}
              role={msg.role as "user" | "assistant"}
            />
          ))}

          {streaming && (
            <MessageBubble
              isStreaming={streaming.isStreaming}
              parts={streaming.parts}
              role="assistant"
            />
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-400/20 bg-red-400/10 px-4 py-3 text-red-400 text-sm">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="flex-shrink-0 border-white/5 border-t px-4 pt-3 pb-4 md:px-6 md:pb-6">
          <PromptInput disabled={isLoading} onSend={sendMessage} />
          <div className="mt-2 text-center text-[10px] text-white/20">
            TARS has access to Read, Write, Bash, Glob, Grep, WebFetch, Task
          </div>
        </div>
      </div>
    </div>
  );
}
