/**
 * Worker simulator for the M4 PR review workflow.
 *
 * Plays the role of tars-worker (M3) until M3 lands. Listens on the Postgres
 * channel `tars_jobs_new`, picks up pending jobs from the `tars_jobs` table,
 * calls Anthropic / OpenAI APIs (or returns mocked structured responses if
 * NO_LLM=1), and resumes the workflow hook via `resumeHook(token, payload)`.
 *
 * Run:
 *   pnpm tsx scripts/tars-worker-simulator.ts
 *
 * Env:
 *   WORKFLOW_POSTGRES_URL  — workflow + tars_jobs DB
 *   ANTHROPIC_API_KEY      — optional; only used if NO_LLM unset
 *   OPENAI_API_KEY         — optional
 *   NO_LLM=1               — skip LLM calls, return mocked structured replies
 *                            (this is what the M4 integration test uses to
 *                             prove control flow even when keys aren't loaded)
 *   SIM_VERBOSE=1          — verbose logging
 */

import postgres from "postgres";
// Both paths work; we use workflow/api to match the rest of the repo.
import { resumeHook } from "workflow/api";

const PG_URL =
  process.env.WORKFLOW_POSTGRES_URL ??
  process.env.DATABASE_URL ??
  "postgres://tars_app:5bb16db4a6db588a087139b7225537595c0140791c0a037a@127.0.0.1:5433/tars_app";

const NO_LLM = process.env.NO_LLM === "1";
const VERBOSE = process.env.SIM_VERBOSE === "1";

function log(...args: unknown[]) {
  // eslint-disable-next-line no-console
  console.log("[tars-worker-sim]", ...args);
}

function vlog(...args: unknown[]) {
  if (VERBOSE) {
    log(...args);
  }
}

interface JobRow {
  job_id: string;
  kind: string;
  payload: {
    hookToken: string;
    [key: string]: unknown;
  };
  status: string;
}

async function processJob(
  sql: ReturnType<typeof postgres>,
  job: JobRow
): Promise<void> {
  log(`processing job ${job.job_id} kind=${job.kind}`);
  const startedAt = Date.now();
  try {
    await sql/* sql */`
      update tars_jobs set status='running', claimed_at=now() where job_id=${job.job_id}
    `;
    const result = await dispatchKind(job.kind, job.payload);
    await sql/* sql */`
      update tars_jobs
      set status='completed', completed_at=now(), result=${sql.json(result as any)}
      where job_id=${job.job_id}
    `;
    // Resume the workflow hook
    await resumeHook(job.payload.hookToken, result);
    log(
      `done job ${job.job_id} (${job.kind}) in ${Date.now() - startedAt}ms`
    );
  } catch (err) {
    const msg = (err as Error).message;
    log(`error job ${job.job_id} (${job.kind}): ${msg}`);
    await sql/* sql */`
      update tars_jobs
      set status='error', completed_at=now(), error=${msg}
      where job_id=${job.job_id}
    `;
    // Resume the hook with an error-shaped payload that still satisfies schema
    // (validators ignore extra props; we put findings:[] / agreement:partial / etc.)
    const fallback = errorFallbackForKind(job.kind, msg);
    try {
      await resumeHook(job.payload.hookToken, fallback);
    } catch (innerErr) {
      log(`failed to resume hook on error: ${(innerErr as Error).message}`);
    }
  }
}

async function dispatchKind(
  kind: string,
  payload: Record<string, unknown>
): Promise<unknown> {
  if (NO_LLM) {
    return mockedResult(kind, payload);
  }
  // Real LLM dispatch lives in tars-worker M3. The simulator only proves
  // control flow — for "real" responses, set NO_LLM=0 AND ensure M3 runs.
  // We fall back to mocked responses if the LLM keys are missing.
  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    vlog("no LLM keys — using mocked result");
    return mockedResult(kind, payload);
  }
  // Minimal real implementation: call Anthropic for both review and validate.
  return await callAnthropic(kind, payload);
}

async function callAnthropic(
  kind: string,
  payload: Record<string, unknown>
): Promise<unknown> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return mockedResult(kind, payload);
  }
  const prompt = buildPrompt(kind, payload);
  if (!prompt) {
    return mockedResult(kind, payload);
  }
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!resp.ok) {
      throw new Error(`anthropic ${resp.status}: ${await resp.text()}`);
    }
    const data = (await resp.json()) as {
      content: Array<{ type: string; text: string }>;
    };
    const text = data.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    const jsonMatch = text.match(/```json\s*([\s\S]+?)```/) ?? text.match(/\{[\s\S]+\}$/);
    const rawJson = jsonMatch ? (Array.isArray(jsonMatch) ? jsonMatch[1] ?? jsonMatch[0] : jsonMatch) : text;
    return JSON.parse(rawJson as string);
  } catch (err) {
    vlog(`anthropic call failed: ${(err as Error).message} — falling back to mock`);
    return mockedResult(kind, payload);
  }
}

function buildPrompt(kind: string, payload: Record<string, unknown>): string | null {
  switch (kind) {
    case "codex-review": {
      const diff = (payload.diff as string) ?? "";
      return [
        "You are a senior code reviewer. Review the following PR diff and produce structured findings.",
        "Reply ONLY with JSON matching this schema:",
        '{ "findings": [{"file": "path", "line": 10, "severity": "critical|major|minor|nit", "category": "bug|security|...", "message": "..."}], "summary": "..." }',
        "",
        "DIFF:",
        diff.slice(0, 60_000),
      ].join("\n");
    }
    case "claude-validate": {
      const findings = JSON.stringify(payload.findings ?? []);
      const diff = (payload.diff as string) ?? "";
      return [
        "Validate these PR review findings. Reject false positives, add anything missed.",
        "Reply ONLY with JSON:",
        '{ "agreement": "agree|partial|disagree", "validatedFindings": [...], "newFindings": [...], "rejectedFindings": [{"finding": {...}, "reason": "..."}], "rationale": "..." }',
        "",
        "FINDINGS:",
        findings,
        "",
        "DIFF:",
        diff.slice(0, 40_000),
      ].join("\n");
    }
    case "verify-in-context": {
      return [
        "Given these findings and blast-radius context, drop any that conflict with project intent.",
        "Reply ONLY with JSON: { \"contextNotes\": \"...\", \"finalFindings\": [...], \"droppedFindings\": [{\"finding\": {...}, \"reason\": \"...\"}] }",
        "",
        JSON.stringify(payload),
      ].join("\n");
    }
    default:
      return null;
  }
}

function mockedResult(kind: string, payload: Record<string, unknown>): unknown {
  switch (kind) {
    case "codex-review": {
      // Try to produce ONE plausible finding so the workflow exercises every
      // downstream step. We use the first file from the PR.
      const files = (payload.files as Array<{ filename: string }> | undefined) ?? [];
      const file = files[0]?.filename ?? "README.md";
      return {
        findings: [
          {
            file,
            line: 1,
            severity: "minor" as const,
            category: "documentation" as const,
            message:
              "Consider adding inline documentation for the new logic introduced by this PR.",
            suggestion: "Add a short docstring describing the new behavior.",
          },
        ],
        summary:
          "Mocked review by tars-worker-simulator (NO_LLM). One nominal finding to exercise the pipeline.",
        rawModel: "mocked",
      };
    }
    case "claude-validate": {
      const findings = (payload.findings as unknown[]) ?? [];
      return {
        agreement: "agree" as const,
        validatedFindings: findings,
        newFindings: [],
        rejectedFindings: [],
        rationale:
          "Mocked validate by tars-worker-simulator — all findings accepted.",
      };
    }
    case "verify-in-context": {
      const findings = (payload.findings as unknown[]) ?? [];
      return {
        contextNotes:
          "Mocked context verify — blast radius and project notes consumed.",
        finalFindings: findings,
        droppedFindings: [],
      };
    }
    case "fix-propose": {
      return {
        patch: "",
        rationale:
          "Mocked fix-propose — autofix disabled in this simulator path.",
        commitMessage: "",
        filesTouched: [],
      };
    }
    case "fix-validate": {
      return {
        approved: false,
        rationale: "Mocked fix-validate — no patch to validate.",
        hardBlockers: [],
      };
    }
    default:
      return {};
  }
}

function errorFallbackForKind(kind: string, _msg: string): unknown {
  switch (kind) {
    case "codex-review":
      return { findings: [], summary: "worker error" };
    case "claude-validate":
      return {
        agreement: "disagree" as const,
        validatedFindings: [],
        newFindings: [],
        rejectedFindings: [],
        rationale: "worker error",
      };
    case "verify-in-context":
      return { contextNotes: "worker error", finalFindings: [], droppedFindings: [] };
    case "fix-propose":
      return { patch: "", rationale: "worker error", commitMessage: "", filesTouched: [] };
    case "fix-validate":
      return { approved: false, rationale: "worker error", hardBlockers: ["worker error"] };
    default:
      return {};
  }
}

async function drainPending(sql: ReturnType<typeof postgres>): Promise<void> {
  const pending = (await sql/* sql */`
    select job_id, kind, payload, status from tars_jobs where status='pending' order by created_at asc limit 50
  `) as unknown as JobRow[];
  for (const j of pending) {
    // eslint-disable-next-line no-await-in-loop
    await processJob(sql, j);
  }
}

async function main() {
  const sql = postgres(PG_URL, { max: 4, idle_timeout: 0, prepare: false });
  // Ensure tars_jobs exists
  await sql/* sql */`
    create table if not exists tars_jobs (
      job_id            text primary key,
      kind              text not null,
      payload           jsonb not null,
      status            text not null default 'pending',
      result            jsonb,
      error             text,
      created_at        timestamptz not null default now(),
      claimed_at        timestamptz,
      completed_at      timestamptz
    );
  `;
  log(`connected. NO_LLM=${NO_LLM} verbose=${VERBOSE}`);

  await drainPending(sql);

  await sql.listen("tars_jobs_new", async (payload) => {
    const jobId = (payload ?? "").trim();
    vlog(`notify tars_jobs_new ${jobId}`);
    const rows = (await sql/* sql */`
      select job_id, kind, payload, status from tars_jobs where job_id=${jobId} and status='pending' limit 1
    `) as unknown as JobRow[];
    if (rows.length > 0) {
      await processJob(sql, rows[0]);
    }
  });

  log("listening on tars_jobs_new");
  // Keep alive
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await new Promise((r) => setTimeout(r, 60_000));
    await drainPending(sql);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("simulator crashed:", err);
  process.exit(1);
});
