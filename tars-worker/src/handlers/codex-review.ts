import { Codex } from "@openai/codex-sdk";
import { z } from "zod";
import { makeOpenAIStrict } from "../openaiStrictSchema.js";
// Zod v4 has built-in toJSONSchema
import type { JobHandler } from "../types.js";

const FENCED_JSON_RE = /```(?:json)?\s*([\s\S]+?)```/;

const ReviewInputSchema = z.object({
  diff: z.string().min(1),
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

export type CodexReviewOutput = z.infer<typeof ReviewOutputSchema>;

export const codexReviewHandler: JobHandler = async (ctx) => {
  const input = ReviewInputSchema.parse(ctx.job.payload);

  const env = { ...process.env } as Record<string, string | undefined>;
  delete env.OPENAI_API_KEY;
  delete env.OPENAI_BASE_URL;
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

  const prompt = [
    "You are a senior code reviewer. Review the diff and return ONLY a JSON object matching the provided schema.",
    input.repo ? `Repo: ${input.repo}` : null,
    typeof input.prNumber === "number" ? `PR #${input.prNumber}` : null,
    input.context ? `Context:\n${input.context}` : null,
    `Diff:\n\`\`\`diff\n${input.diff}\n\`\`\``,
  ]
    .filter(Boolean)
    .join("\n\n");

  ctx.log("codex-review: starting run");
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
