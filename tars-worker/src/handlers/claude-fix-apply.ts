import { spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { JobHandler } from "../types.js";

const FixInputSchema = z.object({
  repoUrl: z.string().url().optional(),
  repoPath: z.string().min(1),
  branch: z.string().optional(),
  instructions: z.string().min(1),
  context: z.string().optional(),
});

export type ClaudeFixApplyOutput = {
  diff: string;
  shortstat: string;
  filesChanged: string[];
  summary: string;
  sessionId?: string;
};

export const claudeFixApplyHandler: JobHandler = async (ctx) => {
  const input = FixInputSchema.parse(ctx.job.payload);

  await ensureRepo(input.repoPath, input.repoUrl, input.branch);

  const prompt = [
    "Apply the requested fix to this repository. Use Edit/Write/Bash as needed.",
    "After editing, run any relevant tests if a quick test command is obvious.",
    "Do NOT commit. Leave the working tree dirty so the caller can inspect the diff.",
    "",
    input.context ? "Context:\n" + input.context : null,
    "Instructions:\n" + input.instructions,
  ]
    .filter(Boolean)
    .join("\n");

  ctx.log("claude-fix-apply: starting query", { cwd: input.repoPath });

  const q = query({
    prompt,
    options: {
      model: "claude-sonnet-4-6",
      allowedTools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
      permissionMode: "acceptEdits",
      cwd: input.repoPath,
      env: {
        ...process.env,
        CLAUDE_AGENT_SDK_CLIENT_APP: "tars-worker/0.1.0",
      },
    },
  });

  let sessionId: string | undefined;
  let summary = "";
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
    } else if (msg.type === "result") {
      sessionId = msg.session_id ?? sessionId;
      if (msg.subtype === "success") {
        summary = msg.result ?? "";
      } else {
        throw new Error("claude-fix-apply failed: " + msg.subtype);
      }
    }
  }

  const diff = await runGit(input.repoPath, ["diff"]);
  const shortstat = await runGit(input.repoPath, ["diff", "--shortstat"]);
  const filesChangedRaw = await runGit(input.repoPath, [
    "diff",
    "--name-only",
  ]);
  const filesChanged = filesChangedRaw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    diff,
    shortstat: shortstat.trim(),
    filesChanged,
    summary,
    sessionId,
  };
};

async function ensureRepo(
  repoPath: string,
  repoUrl: string | undefined,
  branch: string | undefined,
): Promise<void> {
  try {
    await access(repoPath + "/.git");
    if (branch) {
      await runGit(repoPath, ["fetch", "origin", branch]).catch(() => undefined);
      await runGit(repoPath, ["checkout", branch]).catch(() => undefined);
    }
    return;
  } catch {
    // not present — clone
  }
  if (!repoUrl) {
    throw new Error("repoPath " + repoPath + " does not exist and no repoUrl given");
  }
  await mkdir(dirname(repoPath), { recursive: true });
  const cloneArgs = ["clone"];
  if (branch) cloneArgs.push("--branch", branch);
  cloneArgs.push(repoUrl, repoPath);
  await runGit(dirname(repoPath), cloneArgs);
}

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd });
    let out = "";
    let err = "";
    child.stdout.on("data", (b) => {
      out += String(b);
    });
    child.stderr.on("data", (b) => {
      err += String(b);
    });
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error("git " + args.join(" ") + " (exit " + code + "): " + err));
    });
    child.on("error", reject);
  });
}
