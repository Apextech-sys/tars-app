"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  MessageSquare,
  Plus,
  Send,
  Trash2,
  ChevronRight,
  Terminal,
  FileText,
  Globe,
  Cpu,
  Loader2,
  AlertCircle,
} from "lucide-react";
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
  if (n === "bash" || n === "computer")
    return <Terminal className="h-3.5 w-3.5" />;
  if (n === "read" || n === "write" || n === "edit" || n === "glob")
    return <FileText className="h-3.5 w-3.5" />;
  if (n === "webfetch" || n === "websearch")
    return <Globe className="h-3.5 w-3.5" />;
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
    <div className="my-2 rounded-lg border border-white/10 bg-black/20 text-xs overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/5 transition-colors"
      >
        <span className="text-[#00d4a0]">
          <ToolIcon name={part.toolName ?? ""} />
        </span>
        <span className="font-mono text-[#00d4a0] font-medium">
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
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="border-t border-white/10 px-3 py-2 space-y-2">
              {argsStr !== "{}" && (
                <div>
                  <div className="text-white/40 mb-1 text-[10px] uppercase tracking-wider">
                    Input
                  </div>
                  <pre className="text-white/70 whitespace-pre-wrap break-all font-mono text-[11px] max-h-40 overflow-y-auto">
                    {argsStr}
                  </pre>
                </div>
              )}
              {resultStr && (
                <div>
                  <div className="text-white/40 mb-1 text-[10px] uppercase tracking-wider">
                    Output
                  </div>
                  <pre className="text-white/70 whitespace-pre-wrap break-all font-mono text-[11px] max-h-60 overflow-y-auto">
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
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        "flex gap-3 max-w-full",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      {!isUser && (
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-[#00d4a0]/20 border border-[#00d4a0]/40 flex items-center justify-center mt-0.5">
          <span className="text-[10px] font-bold text-[#00d4a0]">T</span>
        </div>
      )}

      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
          isUser
            ? "bg-[#00d4a0]/20 border border-[#00d4a0]/30 text-white ml-auto"
            : "bg-white/5 border border-white/10 text-white/90"
        )}
      >
        {parts.map((part, i) => {
          if (part.type === "text" && part.text) {
            return (
              <div
                key={`text-${part.toolCallId ?? ""}-${i}`}
                className="whitespace-pre-wrap"
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
                  part.toolCallId
                    ? toolResults.get(part.toolCallId)
                    : undefined
                }
              />
            );
          }
          return null;
        })}
        {isStreaming && (
          <span className="inline-flex items-center gap-1 ml-1">
            <span className="w-1 h-3 bg-[#00d4a0] animate-pulse rounded-sm" />
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
    <div className="flex flex-col h-full border-r border-white/10 bg-black/30 backdrop-blur-sm w-64 flex-shrink-0">
      <div className="p-4 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-[#00d4a0]" />
          <span className="text-sm font-semibold text-white">TARS Chat</span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={onNew}
          className="h-7 w-7 p-0 hover:bg-[#00d4a0]/20 hover:text-[#00d4a0]"
          title="New conversation"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {loading ? (
          <div className="flex items-center justify-center p-4">
            <Loader2 className="h-4 w-4 animate-spin text-white/40" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center text-white/30 text-xs p-4">
            No conversations yet
          </div>
        ) : (
          sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s.id)}
              className={cn(
                "group w-full text-left rounded-lg px-3 py-2.5 text-xs transition-all flex items-start justify-between gap-2",
                activeId === s.id
                  ? "bg-[#00d4a0]/15 border border-[#00d4a0]/30 text-white"
                  : "text-white/60 hover:bg-white/5 hover:text-white/90 border border-transparent"
              )}
            >
              <span className="flex-1 truncate">
                {s.title ?? "New conversation"}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(s.id);
                }}
                className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-red-400 transition-all flex-shrink-0 mt-0.5"
                title="Archive"
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
    if (!value.trim() || disabled) return;
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
    <div className="relative border border-white/10 rounded-2xl bg-white/5 backdrop-blur-sm focus-within:border-[#00d4a0]/50 transition-colors">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder="Message TARS... (Enter to send, Shift+Enter for newline)"
        rows={1}
        className="w-full resize-none bg-transparent px-4 py-3 pr-12 text-sm text-white placeholder:text-white/30 focus:outline-none disabled:opacity-50 max-h-[200px]"
      />
      <button
        type="button"
        onClick={handleSend}
        disabled={disabled || !value.trim()}
        className="absolute right-3 bottom-3 p-1.5 rounded-lg bg-[#00d4a0]/20 hover:bg-[#00d4a0]/40 text-[#00d4a0] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
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
    if (isLoading) return;
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
      if (!reader) throw new Error("No stream body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const colonIdx = line.indexOf(":");
          if (colonIdx === -1) continue;

          const code = line.substring(0, colonIdx);
          const jsonStr = line.substring(colonIdx + 1);

          let parsed: unknown;
          try {
            parsed = JSON.parse(jsonStr);
          } catch {
            continue;
          }

          if (code === "0") {
            // text delta
            fullText += parsed as string;
            setStreaming((prev) => {
              if (!prev) return prev;
              const textParts = prev.parts.filter((p) => p.type !== "text");
              return {
                ...prev,
                parts: [
                  ...textParts,
                  { type: "text", text: fullText },
                ],
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
            setStreaming((prev) => {
              if (!prev) return prev;
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
            setStreaming((prev) => {
              if (!prev) return prev;
              const filtered = prev.parts.filter(
                (p) =>
                  p.type !== "tool-result" ||
                  p.toolCallId !== tr.toolCallId
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
      // Commit streaming message to messages
      setStreaming((prev) => {
        if (!prev) return null;
        const finalParts = prev.parts.map((p) => {
          if (p.type === "text" && !p.text && fullText) {
            return { ...p, text: fullText };
          }
          return p;
        });
        const finalMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          parts: finalParts.length > 0 ? finalParts : [{ type: "text", text: fullText }],
          content: fullText,
          createdAt: new Date().toISOString(),
        };
        setMessages((msgs) => {
          // Remove optimistic user message duplicate if the DB already has it
          return [...msgs, finalMsg];
        });
        return null;
      });
      setIsLoading(false);

      // Refresh sessions list after first message
      await loadSessions();
    }
  };

  // Combine persisted + streaming messages for display
  const allMessages = messages;

  return (
    <div className="flex h-screen bg-[#0a0f0d] text-white overflow-hidden">
      {/* Sidebar */}
      <SessionSidebar
        sessions={sessions}
        activeId={activeSessionId}
        onSelect={loadSession}
        onNew={startNewChat}
        onDelete={deleteSession}
        loading={sessionsLoading}
      />

      {/* Main chat area */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center px-6 py-3 border-b border-white/10 bg-black/20 backdrop-blur-sm flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[#00d4a0] animate-pulse" />
            <span className="text-sm font-medium text-white/80">
              {activeSessionId
                ? sessions.find((s) => s.id === activeSessionId)?.title ??
                  "Conversation"
                : "New conversation"}
            </span>
          </div>
          <div className="ml-auto text-xs text-white/30 font-mono">
            claude-sonnet-4-6 via SDK
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {allMessages.length === 0 && !streaming && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center justify-center h-full text-center"
            >
              <div className="w-16 h-16 rounded-full bg-[#00d4a0]/10 border border-[#00d4a0]/30 flex items-center justify-center mb-4">
                <span className="text-2xl font-bold text-[#00d4a0]">T</span>
              </div>
              <h2 className="text-xl font-semibold text-white mb-2">
                TARS is ready
              </h2>
              <p className="text-white/40 text-sm max-w-sm">
                Your personal operations AI. Ask about your infrastructure,
                projects, or anything else.
              </p>
            </motion.div>
          )}

          {allMessages.map((msg) => (
            <MessageBubble
              key={msg.id}
              role={msg.role as "user" | "assistant"}
              parts={msg.parts as MessagePart[]}
            />
          ))}

          {streaming && (
            <MessageBubble
              role="assistant"
              parts={streaming.parts}
              isStreaming={streaming.isStreaming}
            />
          )}

          {error && (
            <div className="flex items-center gap-2 text-red-400 text-sm bg-red-400/10 border border-red-400/20 rounded-lg px-4 py-3">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="px-6 pb-6 pt-3 flex-shrink-0 border-t border-white/5">
          <PromptInput onSend={sendMessage} disabled={isLoading} />
          <div className="mt-2 text-center text-[10px] text-white/20">
            TARS has access to Read, Write, Bash, Glob, Grep, WebFetch, Task
          </div>
        </div>
      </div>
    </div>
  );
}
