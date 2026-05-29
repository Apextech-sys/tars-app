/**
 * claude-fix-apply (Slice 2 — the FIX stage).
 *
 * Given an APPROVED pr_review_runs context, this handler runs stages 6–10 of
 * the PR-review lifecycle inside a throwaway clone of the target repo:
 *
 *   7.  Re-validate     — Claude independently confirms each agreed finding is
 *                          real against the ACTUAL code (not just the diff).
 *                          Findings it can't reproduce are dropped.
 *   8.  Blast radius     — before editing, Claude traces what calls/imports the
 *                          code it is about to change (the blast radius of the
 *                          FIX, not just the finding).
 *   9.  Fix within radius — applies the fix, constrained to the blast radius;
 *                          no refactor beyond what the finding requires.
 *   10a. Test            — runs the repo's existing test suite LOCALLY (detected
 *                          from package.json). The fix must not break it.
 *   10b. Expand suite     — adds a test that would have caught the bug. Trivial
 *                          cosmetic bugs may skip new tests (recorded with a
 *                          reason).
 *   10c. Root-cause gap   — short analysis of WHY the existing suite missed it.
 *
 * The Agent SDK does the investigation + editing + test work inside the clone.
 * Everything that touches GitHub (branch create, commit, push, open PR) is done
 * deterministically by THIS handler — never by the model — so the safety
 * guarantees hold: we open a PR against the original base branch, we NEVER push
 * to a protected base branch, and we NEVER merge.
 *
 * The workflow (`workflows/pr-fix.ts`) consumes the structured result and drives
 * the Linear lifecycle + persists the bookkeeping on the run row.
 */

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { Octokit } from "@octokit/rest";
import { z } from "zod";
import type { JobHandler } from "../types.js";

const FENCED_JSON_RE = /```(?:json)?\s*([\s\S]+?)```/;

const AgreedFindingSchema = z.object({
  file: z.string(),
  line: z.number().optional(),
  severity: z.string(),
  category: z.string().optional(),
  message: z.string(),
  suggestion: z.string().optional(),
});

const FixInputSchema = z.object({
  runId: z.string().min(1),
  owner: z.string().min(1),
  repo: z.string().min(1),
  prNumber: z.number().int().positive(),
  /** Head SHA of the PR being reviewed — what we check out + fix. */
  prSha: z.string().optional(),
  /** Head branch ref of the original PR. */
  prHeadRef: z.string().optional(),
  /** Base branch of the original PR — the fix PR targets THIS. */
  prBaseRef: z.string().optional(),
  prUrl: z.string().optional(),
  prTitle: z.string().optional(),
  linearIssueIdentifier: z.string().optional(),
  linearIssueUrl: z.string().optional(),
  agreedFindings: z.array(AgreedFindingSchema).min(1),
});

export type FixAgreedFinding = z.infer<typeof AgreedFindingSchema>;

/** Per-finding re-validation outcome (stage 7). */
export interface RevalidatedFinding {
  finding: FixAgreedFinding;
  kept: boolean;
  reason: string;
}

/** The structured bookkeeping the model emits (stages 7/8/10b/10c). */
const ModelReportSchema = z.object({
  revalidation: z.array(
    z.object({
      file: z.string(),
      line: z.number().optional(),
      message: z.string(),
      kept: z.boolean(),
      reason: z.string(),
    })
  ),
  blastRadius: z.object({
    summary: z.string(),
    changedFiles: z.array(z.string()),
    callers: z.array(z.string()),
    notes: z.string().optional(),
  }),
  fixSummary: z.string(),
  testsAdded: z.boolean(),
  testExemptionReason: z.string().nullable().optional(),
  testFiles: z.array(z.string()),
  coverageRootCause: z.string(),
  existingTestsPassed: z.boolean(),
  testCommand: z.string().nullable().optional(),
  testOutputTail: z.string().optional(),
});

export type FixModelReport = z.infer<typeof ModelReportSchema>;

export interface ClaudeFixApplyOutput {
  outcome: "fix-in-review" | "fix-failed";
  /** populated on success */
  fixBranch?: string;
  fixCommitSha?: string;
  fixPrUrl?: string;
  fixPrNumber?: number;
  revalidation: RevalidatedFinding[];
  blastRadius?: FixModelReport["blastRadius"];
  fixSummary?: string;
  testsAdded?: boolean;
  testExemptionReason?: string | null;
  testFiles?: string[];
  coverageRootCause?: string;
  existingTestsPassed?: boolean;
  testCommand?: string | null;
  filesChanged: string[];
  shortstat?: string;
  sessionId?: string;
  error?: string;
}

function ghToken(): string {
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GH_TOKEN / GITHUB_TOKEN env var not set");
  }
  return token;
}

/** Branch names we must never push to or target with a force. */
const PROTECTED_BASE_RE = /^(main|master|develop|dev|v2-main)$/i;

export const claudeFixApplyHandler: JobHandler = async (ctx) => {
  const input = FixInputSchema.parse(ctx.job.payload);
  const token = ghToken();

  const fixBranch = `tars/fix-${input.runId}`;
  const repoSlug = `${input.owner}/${input.repo}`;
  const cloneUrl = `https://x-access-token:${token}@github.com/${repoSlug}.git`;

  // Workspace under /tmp; always cleaned up in `finally`.
  const workspace = await mkdtemp(
    join(tmpdir(), `tars-fix-${input.prNumber}-`)
  );

  const baseFail = (error: string): ClaudeFixApplyOutput => ({
    outcome: "fix-failed",
    revalidation: [],
    filesChanged: [],
    error,
  });

  try {
    // ── Stage 6: clone + checkout the PR head ────────────────────────────────
    ctx.log("claude-fix-apply: cloning", { repo: repoSlug, workspace });
    await git(workspace, ["clone", "--depth", "50", cloneUrl, "."], 120_000);

    // Fetch the PR head (by ref, falling back to SHA) and check out FETCH_HEAD.
    // A bare `git fetch origin <ref>` lands the commit in FETCH_HEAD — it does
    // NOT create a local branch named <ref>, so we must check out FETCH_HEAD
    // (or the SHA) rather than the ref name.
    const fetchSpec = input.prHeadRef ?? input.prSha;
    if (!fetchSpec) {
      return baseFail("no prSha or prHeadRef to check out");
    }
    const fetched = await git(
      workspace,
      ["fetch", "origin", fetchSpec],
      60_000
    ).then(
      () => true,
      () => false
    );
    if (fetched) {
      await git(workspace, ["checkout", "FETCH_HEAD"], 30_000);
    } else if (input.prSha) {
      // Ref fetch failed — try the SHA directly (already in the shallow clone
      // if it's on the default branch, else fetch it).
      await git(workspace, ["fetch", "origin", input.prSha], 60_000).catch(
        () => undefined
      );
      await git(workspace, ["checkout", input.prSha], 30_000);
    } else {
      return baseFail(`could not fetch PR head "${fetchSpec}"`);
    }
    // New branch for the fix.
    await git(workspace, ["checkout", "-b", fixBranch], 30_000);

    // ── Stages 7–10 (investigation + edits + tests) via the Agent SDK ─────────
    // obtainFixReport runs the fix turn and, ONLY if the structured report is
    // missing/unparseable, issues a single recovery turn that resumes the same
    // session to re-emit the JSON (the on-disk edits are preserved either way).
    const reportPath = join(workspace, ".tars-fix-report.json");
    const agent = await obtainFixReport(
      ctx,
      workspace,
      reportPath,
      buildPrompt(input, reportPath)
    );
    const sessionId = agent.sessionId;
    if (agent.error) {
      return { ...baseFail(agent.error), sessionId };
    }

    // ── Parse the structured report (file-first, message-text fallback) ───────
    const report = agent.report;
    if (!report) {
      return {
        ...baseFail(reportParseFailureMessage(agent)),
        sessionId,
      };
    }

    const validated = await validateFixWorkProduct(
      workspace,
      input,
      report,
      sessionId
    );
    if ("failure" in validated) {
      return validated.failure;
    }
    const { revalidation, keptCount, filesChanged, shortstat } = validated;

    // ── Stage 10: commit + push the NEW branch + OPEN the fix PR ──────────────
    // (git/GitHub work is done here, never by the model). The helper enforces
    // that we never push to / target a protected base branch and never merge.
    const opened = await commitPushAndOpenPr({
      workspace,
      token,
      input,
      report,
      revalidation,
      keptCount,
      fixBranch,
    });
    if ("error" in opened) {
      return { ...baseFail(opened.error), sessionId };
    }

    ctx.log("claude-fix-apply: fix PR opened", {
      url: opened.fixPrUrl,
      number: opened.fixPrNumber,
    });

    return {
      outcome: "fix-in-review",
      fixBranch,
      fixCommitSha: opened.fixCommitSha,
      fixPrUrl: opened.fixPrUrl,
      fixPrNumber: opened.fixPrNumber,
      revalidation,
      blastRadius: report.blastRadius,
      fixSummary: report.fixSummary,
      testsAdded: report.testsAdded,
      testExemptionReason: report.testExemptionReason ?? null,
      testFiles: report.testFiles,
      coverageRootCause: report.coverageRootCause,
      existingTestsPassed: report.existingTestsPassed,
      testCommand: report.testCommand ?? null,
      filesChanged,
      shortstat,
      sessionId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.log("claude-fix-apply: failed", { error: message });
    return baseFail(message);
  } finally {
    await rm(workspace, { recursive: true, force: true }).catch(
      () => undefined
    );
  }
};

interface AgentRunResult {
  sessionId?: string;
  resultText: string;
  error?: string;
}

const FIX_AGENT_OPTIONS = {
  model: "claude-sonnet-4-6",
  allowedTools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
  permissionMode: "acceptEdits" as const,
};

function safeInterrupt(q: { interrupt?: () => void }): void {
  try {
    q.interrupt?.();
  } catch {
    // ignore
  }
}

/**
 * Run ONE agent turn inside the workspace; collect session id + final text.
 *
 * When `resume` is supplied, the SDK reloads the conversation history for that
 * session (Agent SDK `query({ options: { resume } })`, v0.3.x), so a follow-up
 * turn retains all context about what the agent already did to the working
 * tree. Edits made in the first turn persist on disk regardless — a resumed
 * turn is only used to coax a structured summary out of the agent.
 */
async function runAgentTurn(
  ctx: Parameters<JobHandler>[0],
  workspace: string,
  prompt: string,
  resume?: string
): Promise<AgentRunResult> {
  ctx.log("claude-fix-apply: starting agent query", {
    cwd: workspace,
    resume: resume ?? null,
  });
  const q = query({
    prompt,
    options: {
      ...FIX_AGENT_OPTIONS,
      cwd: workspace,
      ...(resume ? { resume } : {}),
      env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: "tars-worker/0.2.0" },
    },
  });

  let sessionId: string | undefined = resume;
  for await (const msg of q) {
    if (ctx.signal.aborted) {
      safeInterrupt(q);
      return { sessionId, resultText: "", error: "aborted (job timeout)" };
    }
    if (msg.type === "system" && msg.subtype === "init") {
      sessionId = msg.session_id ?? sessionId;
      if (msg.session_id) {
        await ctx.updateSessionId(msg.session_id);
      }
    } else if (msg.type === "result") {
      return finalizeAgentResult(msg, msg.session_id ?? sessionId);
    }
  }
  return { sessionId, resultText: "" };
}

/** A single agent turn — injectable so the recovery loop is unit-testable. */
export type TurnRunner = (
  ctx: Parameters<JobHandler>[0],
  workspace: string,
  prompt: string,
  resume?: string
) => Promise<AgentRunResult>;

/** Loads + parses the structured report — injectable for the same reason. */
export type ReportLoader = (
  reportPath: string,
  resultText: string
) => Promise<FixModelReport | null>;

export interface FixReportResult {
  report: FixModelReport | null;
  sessionId?: string;
  resultText: string;
  /** populated only when the agent turn itself errored (timeout, dirty exit). */
  error?: string;
  /** true when the recovery re-prompt was issued. */
  recoveryUsed: boolean;
}

/**
 * Run the fix agent, then GUARANTEE-or-recover the structured report.
 *
 * The agent is non-deterministic: it sometimes finishes the actual fix work but
 * returns a prose summary instead of the machine-readable JSON report (PR #6
 * burn-in — a completed fix was discarded because no JSON was emitted). When the
 * first turn yields no parseable report, we issue ONE recovery turn that RESUMES
 * the same session (so the agent keeps full context of what it just did) and
 * asks ONLY for the JSON — no further file edits. The edits already live on disk
 * and are committed from the git diff downstream, so they survive regardless.
 *
 * `turnRunner` / `reportLoader` default to the real implementations; tests
 * inject fakes to prove the second turn fires without a live Claude session.
 */
export async function obtainFixReport(
  ctx: Parameters<JobHandler>[0],
  workspace: string,
  reportPath: string,
  prompt: string,
  deps: { turnRunner?: TurnRunner; reportLoader?: ReportLoader } = {}
): Promise<FixReportResult> {
  const turnRunner = deps.turnRunner ?? runAgentTurn;
  const reportLoader = deps.reportLoader ?? loadReport;

  // ── Turn 1: the real fix work (investigation + edits + tests + report). ──
  const first = await turnRunner(ctx, workspace, prompt);
  if (first.error) {
    return {
      report: null,
      sessionId: first.sessionId,
      resultText: first.resultText,
      error: first.error,
      recoveryUsed: false,
    };
  }

  const report = await reportLoader(reportPath, first.resultText);
  if (report) {
    return {
      report,
      sessionId: first.sessionId,
      resultText: first.resultText,
      recoveryUsed: false,
    };
  }

  // ── Recovery: same session, JSON-only, no edits. ─────────────────────────
  ctx.log("claude-fix-apply: fix-report-recovery", {
    reason: "first turn produced no parseable report; resuming session",
    sessionId: first.sessionId ?? null,
    firstResultPreview: first.resultText.slice(0, 200),
  });

  const recovery = await turnRunner(
    ctx,
    workspace,
    buildRecoveryPrompt(reportPath),
    first.sessionId
  );
  const recovered = await reportLoader(reportPath, recovery.resultText);

  return {
    report: recovered,
    sessionId: recovery.sessionId ?? first.sessionId,
    resultText: recovery.resultText || first.resultText,
    error: recovery.error,
    recoveryUsed: true,
  };
}

/** Build the terminal error message when no report could be parsed. */
function reportParseFailureMessage(agent: FixReportResult): string {
  const recoveryNote = agent.recoveryUsed
    ? " (recovery re-prompt was attempted)"
    : "";
  return `could not parse fix report${recoveryNote}. First 400 chars of result: ${agent.resultText.slice(
    0,
    400
  )}`;
}

/** Convert a terminal `result` message into an AgentRunResult. */
function finalizeAgentResult(
  // biome-ignore lint/suspicious/noExplicitAny: SDK result message shape
  msg: any,
  sessionId: string | undefined
): AgentRunResult {
  if (msg.subtype === "success") {
    return { sessionId, resultText: msg.result ?? "" };
  }
  return {
    sessionId,
    resultText: "",
    error: `agent did not finish cleanly: ${msg.subtype}`,
  };
}

/** Map the model's re-validation entries back onto the agreed findings. */
function mapRevalidation(
  report: FixModelReport,
  agreed: FixAgreedFinding[]
): RevalidatedFinding[] {
  return report.revalidation.map((r) => {
    const match =
      agreed.find(
        (f) => f.file === r.file && (r.line == null || f.line === r.line)
      ) ?? agreed.find((f) => f.message === r.message);
    return {
      finding:
        match ??
        ({
          file: r.file,
          line: r.line,
          severity: "minor",
          message: r.message,
        } as FixAgreedFinding),
      kept: r.kept,
      reason: r.reason,
    };
  });
}

interface ValidatedWorkProduct {
  revalidation: RevalidatedFinding[];
  keptCount: number;
  filesChanged: string[];
  shortstat: string;
}

/**
 * Gate the agent's work product before we commit anything: at least one
 * finding must survive re-validation, there must be a real diff, and the
 * existing suite must pass. Returns the validated data or a terminal failure.
 */
async function validateFixWorkProduct(
  workspace: string,
  input: z.infer<typeof FixInputSchema>,
  report: FixModelReport,
  sessionId: string | undefined
): Promise<ValidatedWorkProduct | { failure: ClaudeFixApplyOutput }> {
  const revalidation = mapRevalidation(report, input.agreedFindings);
  const keptCount = revalidation.filter((r) => r.kept).length;
  const base = {
    revalidation,
    blastRadius: report.blastRadius,
    fixSummary: report.fixSummary,
    coverageRootCause: report.coverageRootCause,
    existingTestsPassed: report.existingTestsPassed,
    testCommand: report.testCommand ?? null,
    sessionId,
  };

  if (keptCount === 0) {
    return {
      failure: {
        outcome: "fix-failed",
        filesChanged: [],
        ...base,
        error:
          "Re-validation dropped every agreed finding — nothing reproducible to fix.",
      },
    };
  }

  const shortstat = (
    await git(workspace, ["diff", "--shortstat"], 15_000)
  ).trim();
  const filesChanged = (await git(workspace, ["diff", "--name-only"], 15_000))
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  if (filesChanged.length === 0) {
    return {
      failure: {
        outcome: "fix-failed",
        filesChanged: [],
        ...base,
        error: "Agent reported a fix but the working tree is clean (no diff).",
      },
    };
  }

  if (!report.existingTestsPassed) {
    return {
      failure: {
        outcome: "fix-failed",
        filesChanged,
        shortstat,
        testsAdded: report.testsAdded,
        testFiles: report.testFiles,
        ...base,
        existingTestsPassed: false,
        error: `Existing test suite did not pass after the fix. Tail:\n${(report.testOutputTail ?? "").slice(-1500)}`,
      },
    };
  }

  return { revalidation, keptCount, filesChanged, shortstat };
}

interface OpenedPr {
  fixCommitSha: string;
  fixPrUrl: string;
  fixPrNumber: number;
}

/**
 * Commit the agent's edits to the fix branch, push it, and open a PR against
 * the original base branch. Enforces SAFETY in code: never pushes to / targets
 * a protected base branch, never merges. Returns the opened PR or an error.
 */
async function commitPushAndOpenPr(args: {
  workspace: string;
  token: string;
  input: z.infer<typeof FixInputSchema>;
  report: FixModelReport;
  revalidation: RevalidatedFinding[];
  keptCount: number;
  fixBranch: string;
}): Promise<OpenedPr | { error: string }> {
  const {
    workspace,
    token,
    input,
    report,
    revalidation,
    keptCount,
    fixBranch,
  } = args;

  if (PROTECTED_BASE_RE.test(fixBranch)) {
    return { error: `refusing to push to protected branch "${fixBranch}"` };
  }
  const baseRef = input.prBaseRef ?? "main";
  if (baseRef === fixBranch) {
    return { error: "base ref equals fix branch — refusing" };
  }

  await git(
    workspace,
    [
      "-c",
      "user.email=tars-bot@apextech.group",
      "-c",
      "user.name=TARS Fix Bot",
      "commit",
      "-am",
      commitMessage(input, report),
    ],
    30_000
  );
  const fixCommitSha = (
    await git(workspace, ["rev-parse", "HEAD"], 10_000)
  ).trim();

  await git(workspace, ["push", "origin", fixBranch], 90_000);

  const octo = new Octokit({ auth: token, userAgent: "tars-pr-fix/0.2" });
  const created = await octo.pulls.create({
    owner: input.owner,
    repo: input.repo,
    title: prTitle(input, keptCount),
    head: fixBranch,
    base: baseRef,
    body: buildPrBody(input, report, revalidation, fixCommitSha),
    draft: false, // never auto-merge; this is for human review
  });

  return {
    fixCommitSha,
    fixPrUrl: created.data.html_url,
    fixPrNumber: created.data.number,
  };
}

function buildPrompt(
  input: z.infer<typeof FixInputSchema>,
  reportPath: string
): string {
  const findingLines = input.agreedFindings
    .map((f, i) => {
      const loc = f.line ? `${f.file}:${f.line}` : f.file;
      const sug = f.suggestion ? `\n   suggestion: ${f.suggestion}` : "";
      return `${i + 1}. [${f.severity}] ${loc}\n   ${f.message}${sug}`;
    })
    .join("\n");

  return [
    "You are TARS's autonomous fix stage. A dual-AI review agreed on the findings",
    "below for a pull request, and Shaun has APPROVED them for fixing. You are",
    "working inside a fresh clone checked out at the PR head. Do the following,",
    "IN ORDER, and stay strictly within scope:",
    "",
    "STAGE 7 — RE-VALIDATE each finding against the ACTUAL code (read the real",
    "files, do not trust the finding text or a diff). For each finding decide",
    "kept=true (you reproduced it / confirmed it is real) or kept=false (you",
    "could not reproduce it). Record a one-line reason for each.",
    "",
    "STAGE 8 — BLAST RADIUS of the FIX. Before editing, trace what calls or",
    "imports the code you are about to change (grep for the symbol/function/file",
    "across the repo). List the files you will change and the callers that could",
    "be affected. This bounds your edit.",
    "",
    "STAGE 9 — FIX, constrained to that blast radius. Fix ONLY what the kept",
    "findings require. Do NOT refactor unrelated code, do NOT reformat files, do",
    "NOT gold-plate. Minimal, surgical edits.",
    "",
    "STAGE 10a — RUN the existing test suite LOCALLY. Detect the command from",
    "package.json (e.g. the `test` script; prefer a fast/targeted invocation if",
    "the full suite is huge). Capture whether it passed. Do NOT use GitHub",
    "Actions. If there is genuinely no test command, record that.",
    "",
    "STAGE 10b — EXPAND the suite: add a test that would have CAUGHT this bug.",
    "EXCEPTION: a trivial/cosmetic bug (typo, comment, log string) may skip a new",
    "test — if so, set testsAdded=false and give a testExemptionReason. Use",
    "judgment. Re-run tests after adding.",
    "",
    "STAGE 10c — ROOT-CAUSE the coverage gap: one short paragraph on WHY the",
    "existing suite missed this (e.g. 'no test exercised the null-input path').",
    "",
    "Do NOT commit, do NOT touch git, do NOT push, do NOT open a PR — the harness",
    "does all git/GitHub work. Just leave your edits in the working tree.",
    "",
    "WHEN DONE, write a JSON report to this exact path (use the Write tool):",
    `  ${reportPath}`,
    "with this shape (no prose, valid JSON only):",
    "{",
    '  "revalidation": [{"file","line"?,"message","kept":bool,"reason"}],',
    '  "blastRadius": {"summary","changedFiles":[...],"callers":[...],"notes"?},',
    '  "fixSummary": "what you changed and why",',
    '  "testsAdded": bool,',
    '  "testExemptionReason": string|null,',
    '  "testFiles": [paths of test files you added/edited],',
    '  "coverageRootCause": "why the suite missed it",',
    '  "existingTestsPassed": bool,',
    '  "testCommand": "the command you ran"|null,',
    '  "testOutputTail": "last ~40 lines of test output"',
    "}",
    "",
    "Findings to fix:",
    findingLines,
    "",
    `Context: ${input.owner}/${input.repo}#${input.prNumber} — ${input.prTitle ?? ""}`,
  ].join("\n");
}

/**
 * Recovery re-prompt. Issued on a RESUMED session ONLY when the first turn
 * finished its fix work but failed to leave a parseable report. The agent
 * already has full context of what it did; this turn must NOT change files —
 * it only re-emits the structured summary the parser needs. Schema fields below
 * mirror exactly what `ModelReportSchema` / `buildPrompt` document.
 */
function buildRecoveryPrompt(reportPath: string): string {
  return [
    "You did NOT produce the required machine-readable report on your previous",
    "turn — you returned prose (or nothing parseable). Your code edits are fine",
    "and must be LEFT EXACTLY AS THEY ARE: do NOT change, add, or revert any",
    "files; do NOT run any commands; do NOT touch git.",
    "",
    "Your ONLY task now is to emit the structured report describing the work you",
    `already did. If you already wrote ${reportPath}, just re-emit its contents`,
    "verbatim as raw JSON.",
    "",
    "Output ONLY a single JSON object matching EXACTLY this schema — no prose, no",
    "markdown, no code fences, nothing before or after the JSON:",
    "{",
    '  "revalidation": [{"file": str, "line"?: num, "message": str, "kept": bool, "reason": str}],',
    '  "blastRadius": {"summary": str, "changedFiles": [str], "callers": [str], "notes"?: str},',
    '  "fixSummary": "what you changed and why",',
    '  "testsAdded": bool,',
    '  "testExemptionReason": string|null,',
    '  "testFiles": [paths of test files you added/edited],',
    '  "coverageRootCause": "why the suite missed it",',
    '  "existingTestsPassed": bool,',
    '  "testCommand": "the command you ran"|null,',
    '  "testOutputTail": "last ~40 lines of test output"',
    "}",
    "",
    "Reflect your ACTUAL work from the previous turn — do not invent values.",
    `You may also (re)write the report to ${reportPath} using the Write tool, but`,
    "you MUST also output the same JSON as your final message.",
  ].join("\n");
}

export async function loadReport(
  reportPath: string,
  resultText: string
): Promise<FixModelReport | null> {
  // 1. Prefer the file the model was told to write.
  try {
    const raw = await readFile(reportPath, "utf8");
    const parsed = ModelReportSchema.safeParse(JSON.parse(raw));
    if (parsed.success) {
      return parsed.data;
    }
  } catch {
    // fall through to text parsing
  }
  // 2. Fall back to JSON embedded in the model's final message.
  const candidates: string[] = [];
  const fenced = resultText.match(FENCED_JSON_RE);
  if (fenced) {
    candidates.push(fenced[1].trim());
  }
  const first = resultText.indexOf("{");
  const last = resultText.lastIndexOf("}");
  if (first >= 0 && last > first) {
    candidates.push(resultText.slice(first, last + 1));
  }
  for (const c of candidates) {
    try {
      const parsed = ModelReportSchema.safeParse(JSON.parse(c));
      if (parsed.success) {
        return parsed.data;
      }
    } catch {
      // try next
    }
  }
  return null;
}

function prTitle(
  input: z.infer<typeof FixInputSchema>,
  keptCount: number
): string {
  return `[TARS fix] ${input.owner}/${input.repo}#${input.prNumber}: ${keptCount} approved finding${keptCount === 1 ? "" : "s"}`;
}

function commitMessage(
  input: z.infer<typeof FixInputSchema>,
  report: FixModelReport
): string {
  const lines = [
    `fix: address ${input.agreedFindings.length} reviewed finding(s) on #${input.prNumber}`,
    "",
    report.fixSummary,
    "",
    `TARS run: ${input.runId}`,
  ];
  if (input.linearIssueIdentifier) {
    lines.push(`Linear: ${input.linearIssueIdentifier}`);
  }
  return lines.join("\n");
}

function loc(finding: FixAgreedFinding): string {
  return finding.line ? `${finding.file}:${finding.line}` : finding.file;
}

function findingsSection(revalidation: RevalidatedFinding[]): string[] {
  const kept = revalidation.filter((r) => r.kept);
  const dropped = revalidation.filter((r) => !r.kept);
  const out: string[] = ["## Findings fixed"];
  if (kept.length === 0) {
    out.push("_None reproduced._");
  } else {
    out.push(
      ...kept.map(
        (r) =>
          `- **[${r.finding.severity}]** \`${loc(r.finding)}\` — ${r.finding.message}`
      )
    );
  }
  if (dropped.length > 0) {
    out.push(
      "",
      "## Dropped on re-validation",
      "_Claude independently re-checked these against the real code and could not reproduce them:_",
      ...dropped.map((r) => `- \`${loc(r.finding)}\` — ${r.reason}`)
    );
  }
  return out;
}

function blastSection(blast: FixModelReport["blastRadius"]): string[] {
  const out: string[] = ["", "## Blast radius of the fix", blast.summary];
  if (blast.changedFiles.length > 0) {
    out.push(
      "",
      "Changed files:",
      ...blast.changedFiles.map((f) => `- \`${f}\``)
    );
  }
  if (blast.callers.length > 0) {
    out.push(
      "",
      "Callers in radius:",
      ...blast.callers.slice(0, 25).map((c) => `- \`${c}\``)
    );
  }
  return out;
}

function testsSection(report: FixModelReport): string[] {
  const added = report.testsAdded
    ? `Added regression coverage that would have caught this bug${
        report.testFiles.length
          ? ` (${report.testFiles.map((f) => `\`${f}\``).join(", ")})`
          : ""
      }.`
    : `No new test added — ${report.testExemptionReason ?? "trivial/cosmetic change"}.`;
  const suite = `Existing suite: **${report.existingTestsPassed ? "passing" : "FAILING"}**${
    report.testCommand
      ? ` (\`${report.testCommand}\`, run locally on VM 102)`
      : ""
  }.`;
  return ["", "## Tests", added, suite];
}

function linksSection(
  input: z.infer<typeof FixInputSchema>,
  commitSha: string
): string[] {
  const out: string[] = ["", "## Links"];
  if (input.prUrl) {
    out.push(`- Original PR: ${input.prUrl}`);
  }
  if (input.linearIssueUrl) {
    out.push(
      `- Linear: [${input.linearIssueIdentifier ?? "issue"}](${input.linearIssueUrl})`
    );
  }
  out.push(`- TARS run: \`${input.runId}\``);
  out.push(`- Fix commit: \`${commitSha.slice(0, 12)}\``);
  return out;
}

function buildPrBody(
  input: z.infer<typeof FixInputSchema>,
  report: FixModelReport,
  revalidation: RevalidatedFinding[],
  commitSha: string
): string {
  return [
    `Automated fix opened by the **TARS PR-review lifecycle** after Shaun approved the agreed findings on #${input.prNumber}.`,
    "",
    "> This PR is for **human review**. TARS never merges its own fixes.",
    "",
    ...findingsSection(revalidation),
    "",
    "## Fix summary",
    report.fixSummary,
    ...blastSection(report.blastRadius),
    ...testsSection(report),
    "",
    "## Coverage-gap root cause",
    report.coverageRootCause,
    ...linksSection(input, commitSha),
    "",
    "<sub>Generated by the TARS PR-review FIX stage. Status tracks the fix PR.</sub>",
  ].join("\n");
}

function git(cwd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`git ${args[0]} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();
    child.stdout.on("data", (b) => {
      out += String(b);
    });
    child.stderr.on("data", (b) => {
      err += String(b);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(out);
      } else {
        reject(
          new Error(`git ${args.join(" ")} (exit ${code}): ${err.trim()}`)
        );
      }
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

// re-export for the workflow side to write the .tars-fix-report scratch file
// path consistently (kept internal; not used externally yet).
export async function writeScratch(path: string, data: string): Promise<void> {
  await writeFile(path, data, "utf8");
}
