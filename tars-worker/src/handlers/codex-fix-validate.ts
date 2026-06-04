import { Codex } from "@openai/codex-sdk";
import { z } from "zod";
import { makeOpenAIStrict } from "../openaiStrictSchema.js";
// Zod v4 has built-in toJSONSchema
import type { JobHandler } from "../types.js";

const FENCED_JSON_RE = /```(?:json)?\s*([\s\S]+?)```/;

const ValidateInputSchema = z.object({
  diff: z.string().min(1),
  rubric: z.string().min(1),
  context: z.string().optional(),
  cwd: z.string().optional(),
});

const ValidateOutputSchema = z.object({
  agrees: z.boolean(),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  concerns: z.array(z.string()),
});

export type CodexFixValidateOutput = z.infer<typeof ValidateOutputSchema>;

export const codexFixValidateHandler: JobHandler = async (ctx) => {
  const input = ValidateInputSchema.parse(ctx.job.payload);

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

  const prompt = [
    "Validate the candidate diff against the rubric. Return JSON: { agrees, confidence (0-1), rationale, concerns[] }.",
    `Rubric:\n${input.rubric}`,
    input.context ? `Context:\n${input.context}` : null,
    `Candidate diff:\n\`\`\`diff\n${input.diff}\n\`\`\``,
  ]
    .filter(Boolean)
    .join("\n\n");

  ctx.log("codex-fix-validate: starting run");
  const turn = await thread.run(prompt, {
    outputSchema: makeOpenAIStrict(z.toJSONSchema(ValidateOutputSchema)),
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
  return parseValidationJson(text);
};

function parseValidationJson(text: string): CodexFixValidateOutput {
  const tryParse = (s: string): CodexFixValidateOutput | null => {
    try {
      const obj = JSON.parse(s);
      const r = ValidateOutputSchema.safeParse(obj);
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
    const recovered = tryParse(text.slice(first, last + 1));
    if (recovered) {
      return recovered;
    }
  }
  throw new Error(
    "codex-fix-validate output did not contain valid JSON. First 300 chars: " +
      text.slice(0, 300)
  );
}
