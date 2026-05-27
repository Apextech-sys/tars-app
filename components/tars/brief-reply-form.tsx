"use client";

/**
 * BriefReplyForm — captures Shaun's reply to a brief and threads it into
 * a chat session.
 *
 * Flow:
 *   1. POST /api/tars/briefs/[id]/reply with { message } — persists the
 *      reply and returns a `chatSeed` payload.
 *   2. POST /api/chat with chatSeed.{message,sessionId,metadata} — kicks
 *      off the chat thread.
 *   3. On success, redirect to /chat so Shaun sees the running thread.
 *
 * The chat endpoint already exists. The metadata flag { kind:"brief_reply",
 * briefId } is included in the streamed message so the chat handler (and
 * TARS) can see what brief the reply is anchored to.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Props {
  briefId: string;
}

export function BriefReplyForm({ briefId }: Props) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!message.trim()) {
      return;
    }
    setBusy(true);
    try {
      // Step 1 — persist reply, fetch chat seed.
      const r1 = await fetch(`/api/tars/briefs/${briefId}/reply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (!r1.ok) {
        const j = await r1.json().catch(() => ({}));
        throw new Error(
          (j as { error?: string }).error ?? `reply failed (${r1.status})`
        );
      }
      const { chatSeed } = (await r1.json()) as {
        chatSeed: {
          message: string;
          sessionId?: string;
          metadata: { kind: string; briefId: string; briefReplyId: string };
        };
      };

      // Step 2 — kick off chat. The chat endpoint streams; we don't wait
      // for the stream to finish. The chat page picks it up via sessionId.
      const r2 = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: chatSeed.message,
          sessionId: chatSeed.sessionId,
          metadata: chatSeed.metadata,
        }),
      });
      if (!r2.ok) {
        const txt = await r2.text().catch(() => "");
        throw new Error(
          `chat seed failed (${r2.status}): ${txt.slice(0, 200)}`
        );
      }

      // Read the first frame to discover the session id, then bail.
      const sessionId = await peekSessionId(r2.body);
      if (sessionId) {
        router.push(`/chat?session=${encodeURIComponent(sessionId)}`);
      } else {
        router.push("/chat");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={onSubmit}>
      <textarea
        className="w-full rounded-md border border-zinc-800 bg-zinc-950/60 p-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-700 disabled:opacity-50"
        disabled={busy}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Reply to TARS — your message is threaded into a chat session with this brief attached."
        rows={5}
        value={message}
      />
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-zinc-500">
          {message.length} / 10000 characters
        </p>
        <button
          className="rounded-md bg-emerald-600 px-4 py-2 font-medium text-sm text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-zinc-700"
          disabled={busy || !message.trim()}
          type="submit"
        >
          {busy ? "Sending…" : "Send to TARS"}
        </button>
      </div>
      {error ? (
        <p className="rounded border border-rose-900/50 bg-rose-950/40 p-2 text-rose-300 text-xs">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/**
 * The chat endpoint emits AI-SDK-v5 framed lines like `d:{"sessionId":...}`.
 * We read just enough of the stream to pick the sessionId, then abandon
 * the rest so the chat page can pick up the same session from its history.
 */
async function peekSessionId(
  body: ReadableStream<Uint8Array> | null
): Promise<string | null> {
  if (!body) {
    return null;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (let i = 0; i < 32; i++) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const ln of lines) {
        if (ln.startsWith("d:")) {
          try {
            const meta = JSON.parse(ln.slice(2));
            if (typeof meta?.sessionId === "string") {
              return meta.sessionId;
            }
          } catch {
            // ignore
          }
        }
      }
    }
  } catch {
    // ignore
  } finally {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  }
  return null;
}

export default BriefReplyForm;
