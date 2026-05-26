import { query } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { JobHandler } from "../types.js";

const ReviewInputSchema = z.object({
  diff: z.string().min(1, "diff is required"),
  context: z.string().optional(),
  repo: z.string().optional(),
  prNumber: z.number().optional(),
  cwd: z.string().optional(),
});

const FindingSchema = z.object({
  severity: z.enum(["critical", "high", "medium", "low", "info"]),
  file: z.string().optional(),
  line: z.number().optional(),
  title: z.string(),
  detail: z.string(),
  suggestion: z.string().optional(),
});

const ReviewOutputSchema = z.object({
  summary: z.string(),
  findings: z.array(FindingSchema),
  verdict: z.enum(["approve", "request-changes", "comment", "block"]),
});

export type ClaudeReviewInput = z.infer<typeof ReviewInputSchema>;
export type ClaudeReviewOutput = z.infer<typeof ReviewOutputSchema>;

const SYSTEM_PROMPT = `You are a senior code reviewer. Given a diff (and optional context), produce a JSON object with this shape:

{
  "summary": "1-3 sentence high-level summary of the change",
  "findings": [
    {
      "severity": "critical|high|medium|low|info",
      "file": "path/to/file",
      "line": 42,
      "title": "short title",
      "detail": "what's wrong and why it matters",
      "suggestion": "concrete fix (optional)"
    }
  ],
  "verdict": "approve|request-changes|comment|block"
}

Rules:
- Emit ONLY the JSON object. No prose, no markdown fences.
- "findings" may be an empty array if the change is clean.
- Use "block" only for security/correctness issues that must not ship.
- Use "approve" when the change is good. Use "comment" for nits-only feedback.
- Use Read/Grep/Glob if you need to confirm context, but stay focused on the diff.`;

export const claudeReviewHandler: JobHandler = async (ctx) => {
  const input = ReviewInputSchema.parse(ctx.job.payload);

  const userPrompt = [
    input.repo ? `Repo: ${input.repo}` : null,
    typeof input.prNumber === "number" ? `PR #${input.prNumber}` : null,
    input.context ? `Context:\n${input.context}` : null,
    `Diff:\n\`\`\`diff\n${input.diff}\n\`\`\``,
    "Return ONLY the JSON review object — no markdown, no commentary.",
  ]
    .filter(Boolean)
    .join("\n\n");

  ctx.log("claude-review: starting query");

  const q = query({
    prompt: userPrompt,
    options: {
      model: "claude-sonnet-4-6",
      systemPrompt: SYSTEM_PROMPT,
      allowedTools: ["Read", "Grep", "Glob"],
      permissionMode: "default",
      cwd: input.cwd,
      env: {
        ...process.env,
        CLAUDE_AGENT_SDK_CLIENT_APP: "tars-worker/0.1.0",
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
      ctx.log("claude-review: session", { sessionId });
    } else if (msg.type === "result") {
      sessionId = msg.session_id ?? sessionId;
      if (msg.subtype === "success") {
        finalText = msg.result;
      } else {
        throw new Error(
          `claude-review failed: ${msg.subtype}` +
            (msg.errors?.length ? ` — ${msg.errors.join("; ")}` : ""),
        );
      }
    }
  }

  if (!finalText) {
    throw new Error("claude-review produced no result text");
  }

  return parseReviewJson(finalText);
};

function parseReviewJson(text: string): ClaudeReviewOutput {
  const tryParse = (s: string): ClaudeReviewOutput | null => {
    try {
      const obj = JSON.parse(s);
      const r = ReviewOutputSchema.safeParse(obj);
      return r.success ? r.data : null;
    } catch {
      return null;
    }
  };

  const direct = tryParse(text.trim());
  if (direct) return direct;

  const fenced = text.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fenced) {
    const inner = tryParse(fenced[1].trim());
    if (inner) return inner;
  }

  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const candidate = text.slice(first, last + 1);
    const recovered = tryParse(candidate);
    if (recovered) return recovered;
  }

  throw new Error(
    `claude-review output did not contain valid review JSON. First 300 chars: ${text.slice(0, 300)}`,
  );
}
