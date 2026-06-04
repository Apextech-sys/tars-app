import { Codex } from "@openai/codex-sdk";
import { z } from "zod";
import { makeOpenAIStrict } from "../openaiStrictSchema.js";
import type { JobHandler } from "../types.js";
// Zod v4 has built-in toJSONSchema
import { DebateContextSchema, debateInstruction } from "./debate-shared.js";

const FENCED_JSON_RE = /```(?:json)?\s*([\s\S]+?)```/;

const ReviewInputSchema = z.object({
  diff: z.string().min(1),
  context: z.string().optional(),
  repo: z.string().optional(),
  prNumber: z.number().optional(),
  cwd: z.string().optional(),
  debateContext: DebateContextSchema.optional(),
});

const SCOPE_RULES = [
  "SCOPE — these are hard constraints, not suggestions:",
  "- Review ONLY the lines this PR changes (added/modified lines in the diff). Do NOT flag pre-existing issues in unchanged code, even if visible for context.",
  "- Do NOT invent issues. If the changed lines are correct, return an EMPTY findings array. An empty findings array is a valid and good outcome.",
  '- Do NOT suggest scope-expanding refactors, style preferences, or "while you\'re here" improvements. Only real defects introduced or directly touched by this PR.',
  "- Every finding's file/line MUST point at a line this PR actually changed. If you cannot tie a finding to a changed line, do not report it.",
].join("\n");

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

export type CodexReviewOutput = z.infer<typeof ReviewOutputSchema>;

export const codexReviewHandler: JobHandler = async (ctx) => {
  const input = ReviewInputSchema.parse(ctx.job.payload);

  const env = { ...process.env } as Record<string, string | undefined>;
  // Strip OpenAI API auth so the Codex SDK uses ChatGPT-login auth instead.
  // These are filtered out below (only string values are copied), so setting
  // them to undefined is equivalent to deleting the keys.
  env.OPENAI_API_KEY = undefined;
  env.OPENAI_BASE_URL = undefined;
  const filteredEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string") {
      filteredEnv[k] = v;
    }
  }
  filteredEnv.HOME = process.env.HOME ?? "/home/shaun";
  filteredEnv.CODEX_HOME =
    process.env.CODEX_HOME ?? `${filteredEnv.HOME}/.codex`;
  filteredEnv.PATH =
    process.env.PATH ??
    "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

  const codex = new Codex({ env: filteredEnv });
  const thread = codex.startThread({
    model: "gpt-5.5",
    sandboxMode: "read-only",
    approvalPolicy: "never",
    skipGitRepoCheck: true,
    workingDirectory: input.cwd,
  });

  const debate = input.debateContext;
  const prompt = [
    "You are a senior code reviewer. Review the diff and return ONLY a JSON object matching the provided schema.",
    SCOPE_RULES,
    input.repo ? `Repo: ${input.repo}` : null,
    typeof input.prNumber === "number" ? `PR #${input.prNumber}` : null,
    input.context ? `Context:\n${input.context}` : null,
    `Diff:\n\`\`\`diff\n${input.diff}\n\`\`\``,
    debate
      ? debateInstruction(
          debate.round,
          debate.otherReviewer,
          debate.otherFindings
        )
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  ctx.log("codex-review: starting run", { debateRound: debate?.round ?? 1 });
  const turn = await thread.run(prompt, {
    outputSchema: makeOpenAIStrict(z.toJSONSchema(ReviewOutputSchema)),
    signal: ctx.signal,
  });

  const threadId =
    (thread as unknown as { id?: string | null }).id ??
    (thread as unknown as { threadId?: string | null }).threadId ??
    null;
  if (threadId) {
    await ctx.updateSessionId(threadId);
  }

  const text = turn.finalResponse ?? "";
  return parseReviewJson(text);
};

function parseReviewJson(text: string): CodexReviewOutput {
  const tryParse = (s: string): CodexReviewOutput | null => {
    try {
      const obj = JSON.parse(s);
      const r = ReviewOutputSchema.safeParse(obj);
      return r.success ? r.data : null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(text.trim());
  if (direct) {
    return direct;
  }
  const fenced = text.match(FENCED_JSON_RE);
  if (fenced) {
    const inner = tryParse(fenced[1].trim());
    if (inner) {
      return inner;
    }
  }
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const candidate = text.slice(first, last + 1);
    const recovered = tryParse(candidate);
    if (recovered) {
      return recovered;
    }
  }
  throw new Error(
    "codex-review output did not contain valid JSON. First 300 chars: " +
      text.slice(0, 300)
  );
}
