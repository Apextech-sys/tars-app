/**
 * claude-brief-compose handler — composes a TARS brief from the context
 * payload dispatched by the brief workflow (workflows/brief.ts).
 *
 * Pipeline inside this handler:
 *   1. Validate the input against BriefComposeInputSchema (zod).
 *   2. Build the user prompt from the validated context — strict JSON only,
 *      no markdown fences, and citations enforced via the system prompt.
 *   3. Call the Claude Agent SDK with SOUL.md as the system prompt PLUS
 *      a tight schema-enforcement instruction block.
 *   4. Parse the result. Tolerate (a) raw JSON, (b) fenced JSON, and
 *      (c) JSON-with-prose-around-it as last-ditch recovery.
 *   5. Validate the parsed object against BriefOutputSchema before returning.
 *
 * SOUL.md is shipped with the tars-app repo; we read it at handler boot
 * the same way /api/chat/route.ts does, so the tone of the composed brief
 * stays consistent with TARS-the-chat-agent's voice.
 *
 * NOTE: This handler is read-only and never posts to Slack/Linear/Notion.
 * Personal briefs are personal (see vm103-polymarket-v2 + project firewall).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  BriefComposeInputSchema,
  BriefOutputSchema,
  type BriefOutput,
} from "../../../lib/tars/brief/schema.js";
import type { JobHandler } from "../types.js";

// Cache SOUL.md at module load. If absent (e.g. handler running outside
// the tars-app workspace), fall back to a minimal persona stub.
let SOUL_PROMPT = "You are TARS — honest, blunt, evidence-first.";
const SOUL_CANDIDATES = [
  process.env.TARS_SOUL_PATH,
  join(process.cwd(), "lib/tars/SOUL.md"),
  join(process.cwd(), "..", "lib/tars/SOUL.md"),
  "/home/shaun/tars-app/lib/tars/SOUL.md",
].filter(Boolean) as string[];
for (const candidate of SOUL_CANDIDATES) {
  try {
    SOUL_PROMPT = readFileSync(candidate, "utf-8");
    break;
  } catch {
    // try next candidate
  }
}

const SCHEMA_INSTRUCTION = `You are composing a twice-daily TARS brief for Shaun.

OUTPUT CONTRACT — MUST follow exactly. The reply MUST be a single JSON object,
no prose around it, no markdown fences. Shape:

{
  "summary": "1-2 sentence headline of the most important thing right now.",
  "body_markdown": "The full brief as GitHub-flavored markdown. Use headings.",
  "insights": [
    {
      "severity": "info" | "watch" | "act",
      "title": "short title",
      "detail": "what's true and why it matters",
      "citation": "graph node name | audit run_id | PR url | projects.yaml key"
    }
  ],
  "next_actions": [
    {
      "owner": "shaun" | "tars" | "partner" | "deferred",
      "title": "imperative phrasing",
      "detail": "what to do, concretely",
      "link": "https://... (optional)"
    }
  ],
  "questions": [
    {
      "question": "the single question you'd ask Shaun if he had 30 seconds",
      "why": "what unlocks if he answers",
      "reply_hint": "the exact one-liner he could paste back (optional)"
    }
  ]
}

RULES:
- Every insight has a citation. No citation = drop the insight.
- "act" severity is reserved for items that are blocking, urgent, or
  decay rapidly. Default to "watch" or "info".
- next_actions[].owner = "shaun" means Shaun must do this himself (no auto).
  Other values mean TARS / a partner / can be deferred safely.
- The body_markdown MUST be standalone — Shaun reads only that on mobile.
  It should mirror the structured fields above with prose context.
- DO NOT cite Konverge/P45 work as if it were Shaun's project. Konverge is
  a Partner (read-only); only mention it as background context, never as
  an action for Shaun unless he is named.
- Personal projects (visibility=personal) stay personal — never imply
  they should be shared externally.
- Currency for South African numbers: ZAR.
- Be honest about gaps. If the graph or audit window is empty, SAY SO and
  emit fewer insights rather than inventing.`;

export const claudeBriefComposeHandler: JobHandler = async (ctx) => {
  const input = BriefComposeInputSchema.parse(ctx.job.payload);

  const userPrompt = buildUserPrompt(input);
  const systemPrompt = `${SOUL_PROMPT}\n\n---\n\n${SCHEMA_INSTRUCTION}`;

  ctx.log("claude-brief-compose: starting", {
    kind: input.kind,
    date: input.date,
    openPRs: input.open_prs.length,
    commits: input.recent_repo_activity.length,
  });

  const q = query({
    prompt: userPrompt,
    options: {
      model: "claude-sonnet-4-6",
      systemPrompt,
      // The composer is purely a reasoner over the payload — no tools.
      allowedTools: [],
      permissionMode: "default",
      env: {
        ...process.env,
        CLAUDE_AGENT_SDK_CLIENT_APP: "tars-worker/0.1.0-brief",
      },
    },
  });

  let finalText: string | undefined;
  let sessionId: string | undefined;

  for await (const msg of q) {
    if (ctx.signal.aborted) {
      try {
        q.interrupt?.();
      } catch {
        // ignore
      }
      throw new Error("aborted");
    }
    if (msg.type === "system" && msg.subtype === "init") {
      sessionId = msg.session_id;
      if (sessionId) await ctx.updateSessionId(sessionId);
      ctx.log("claude-brief-compose: session", { sessionId });
    } else if (msg.type === "result") {
      sessionId = msg.session_id ?? sessionId;
      if (msg.subtype === "success") {
        finalText = msg.result;
      } else {
        throw new Error(
          `claude-brief-compose failed: ${msg.subtype}` +
            (msg.errors?.length ? ` — ${msg.errors.join("; ")}` : ""),
        );
      }
    }
  }

  if (!finalText) {
    throw new Error("claude-brief-compose produced no result text");
  }

  return await parseBriefOutput(finalText);
};

function buildUserPrompt(input: ReturnType<typeof BriefComposeInputSchema.parse>): string {
  const lines: string[] = [];
  lines.push(
    `Compose the ${input.kind} brief for ${input.date}. Window: ${input.windowStart} → ${input.windowEnd}.`,
  );
  lines.push("");
  lines.push("CONTEXT — graph snapshot");
  lines.push("```json");
  lines.push(JSON.stringify(input.graph, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("CONTEXT — projects.yaml summary");
  lines.push("```json");
  lines.push(JSON.stringify(input.projects_yaml_summary, null, 2));
  lines.push("```");
  lines.push("");
  lines.push(
    `CONTEXT — audit_log window (${input.audit_window.total_entries} entries)`,
  );
  lines.push("```json");
  lines.push(JSON.stringify(input.audit_window, null, 2));
  lines.push("```");
  lines.push("");
  lines.push(
    `CONTEXT — open PRs (${input.open_prs.length}), recent issues (${input.recent_issues.length}), commit activity by repo (${input.recent_repo_activity.length})`,
  );
  lines.push("```json");
  lines.push(
    JSON.stringify(
      {
        open_prs: input.open_prs,
        recent_issues: input.recent_issues,
        recent_repo_activity: input.recent_repo_activity,
      },
      null,
      2,
    ),
  );
  lines.push("```");
  lines.push("");
  lines.push(
    "Return ONLY the JSON object described in the system prompt. No prose, no fences.",
  );
  return lines.join("\n");
}

async function parseBriefOutput(text: string): Promise<BriefOutput> {
  const tryParse = (s: string): BriefOutput | null => {
    try {
      const obj = JSON.parse(s);
      const r = BriefOutputSchema.safeParse(obj);
      return r.success ? r.data : null;
    } catch {
      return null;
    }
  };

  /**
   * Escape raw newlines that appear inside JSON string literals. Models
   * regularly emit multi-line markdown inside a `"body_markdown": "..."`
   * value with un-escaped \n, which is invalid JSON. We walk the string
   * character-by-character tracking quote state and replace bare newlines
   * with their escaped form. Quotes inside strings are escaped already
   * (`\"`); we honor that and only flip in/out of string mode on
   * unescaped quotes.
   */
  const reescapeNewlines = (s: string): string => {
    let out = "";
    let inString = false;
    let escaped = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (inString) {
        if (escaped) {
          out += ch;
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          out += ch;
          escaped = true;
          continue;
        }
        if (ch === '"') {
          out += ch;
          inString = false;
          continue;
        }
        if (ch === "\n") {
          out += "\\n";
          continue;
        }
        if (ch === "\r") {
          out += "\\r";
          continue;
        }
        if (ch === "\t") {
          out += "\\t";
          continue;
        }
        out += ch;
      } else {
        out += ch;
        if (ch === '"') {
          inString = true;
        }
      }
    }
    return out;
  };

  /**
   * Some models emit lone UTF-16 surrogate escapes like `\ud83d` without a
   * paired low surrogate. JSON.parse rejects those. Drop the orphan
   * surrogate; the body markdown will be missing one character but the
   * structure stays valid.
   */
  const stripLoneSurrogates = (s: string): string => {
    return s
      // High surrogate not followed by low surrogate escape
      .replace(/\\u(d[89ab][0-9a-fA-F]{2})(?!\\u(d[cdef][0-9a-fA-F]{2}))/g, "")
      // Low surrogate not preceded by high surrogate escape
      .replace(/(?<!\\u(d[89ab][0-9a-fA-F]{2}))\\u(d[cdef][0-9a-fA-F]{2})/g, "");
  };

  const direct = tryParse(text.trim());
  if (direct) return direct;

  // Strip an outer fence by anchoring to the FIRST opening ``` and the
  // LAST closing ```. A non-greedy regex breaks when the body itself
  // contains fenced code blocks.
  const firstFence = text.indexOf("```");
  const lastFence = text.lastIndexOf("```");
  if (firstFence >= 0 && lastFence > firstFence) {
    let inner = text.slice(firstFence + 3, lastFence);
    // Drop a leading "json\n" language tag if present.
    inner = inner.replace(/^[ \t]*json[ \t]*\r?\n/, "");
    inner = inner.trim();
    const innerDirect = tryParse(inner);
    if (innerDirect) return innerDirect;
    const innerEscaped = tryParse(reescapeNewlines(inner));
    if (innerEscaped) return innerEscaped;
    // Strip lone surrogates AND re-escape newlines together.
    const innerCleaned = tryParse(
      reescapeNewlines(stripLoneSurrogates(inner)),
    );
    if (innerCleaned) return innerCleaned;
  }

  // Last-ditch: pull the outermost { ... } block.
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const candidate = text.slice(first, last + 1);
    const recovered = tryParse(candidate);
    if (recovered) return recovered;
    // Try with newline re-escaping.
    const recoveredEscaped = tryParse(reescapeNewlines(candidate));
    if (recoveredEscaped) return recoveredEscaped;
    const recoveredCleaned = tryParse(
      reescapeNewlines(stripLoneSurrogates(candidate)),
    );
    if (recoveredCleaned) return recoveredCleaned;
  }

  // Last-resort: dump the raw text for offline diagnosis. We deliberately
  // do this in the handler (not in the workflow audit) because the audit
  // log row would balloon to many KB on every failure.
  await (async () => {
    try {
      const fs = await import("node:fs/promises");
      await fs.writeFile(
        `/tmp/tars-brief-fail-${Date.now()}.txt`,
        text,
        "utf8",
      );
    } catch {
      // ignore
    }
  })();
  throw new Error(
    `claude-brief-compose output did not contain a valid brief JSON. Length=${text.length}. First 300: ${text.slice(0, 300)} ; Last 300: ${text.slice(-300)}`,
  );
}
