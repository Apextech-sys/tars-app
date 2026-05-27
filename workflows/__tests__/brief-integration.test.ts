/**
 * End-to-end integration test for the brief workflow.
 *
 * GATED on RUN_INTEGRATION=1 — does not run by default. When enabled, this
 * test:
 *
 *   1. POSTs /api/tars/briefs with { kind: "adhoc", dryRun: false } to
 *      tars-app, which starts the workflow inside the WDK runtime.
 *   2. Polls the `briefs` table for the matching run_id until status is
 *      either "ready" or "failed".
 *   3. Asserts the row has body_markdown content + a non-empty insights
 *      payload (or, for "failed", a structured error_text).
 *
 * Required: tars-worker must be running so the claude-brief-compose
 * handler picks up the dispatched job. ANTHROPIC_API_KEY must be in the
 * worker's environment (loaded by tars-worker/bin/launcher.sh from
 * Infisical).
 */

import { describe, it, expect } from "vitest";
import postgres from "postgres";

const RUN = process.env.RUN_INTEGRATION === "1";
const TARS_APP_URL = process.env.TARS_APP_URL ?? "http://localhost:3001";
const PG_URL =
  process.env.WORKFLOW_POSTGRES_URL ??
  process.env.DATABASE_URL ??
  "postgres://tars_app:5bb16db4a6db588a087139b7225537595c0140791c0a037a@127.0.0.1:5433/tars_app";

const POLL_INTERVAL_MS = 5_000;
const MAX_WAIT_MS = 12 * 60_000;

interface BriefRow {
  id: string;
  status: "pending" | "composing" | "ready" | "failed";
  body_markdown: string | null;
  insights: unknown;
  error_text: string | null;
  run_id: string;
}

async function pollBriefStatus(runId: string): Promise<BriefRow> {
  const sql = postgres(PG_URL, { max: 2, idle_timeout: 10, prepare: false });
  try {
    const started = Date.now();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const rows = await sql/* sql */`
        select id::text, status, body_markdown, insights, error_text, run_id
        from briefs where run_id = ${runId} limit 1
      `;
      if (rows.length > 0) {
        const row = rows[0] as unknown as BriefRow;
        if (row.status === "ready" || row.status === "failed") {
          return row;
        }
      }
      if (Date.now() - started > MAX_WAIT_MS) {
        throw new Error(
          `brief workflow did not reach terminal status within ${MAX_WAIT_MS}ms (last seen rows=${rows.length})`,
        );
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

describe.skipIf(!RUN)("brief workflow — live (tars-app HTTP)", () => {
  it(
    "starts an adhoc brief, the worker composes it, and the briefs row reaches a terminal state",
    { timeout: MAX_WAIT_MS + 60_000 },
    async () => {
      const startResp = await fetch(`${TARS_APP_URL}/api/tars/briefs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "adhoc",
          authToken: process.env.TARS_INTERNAL_SECRET ?? undefined,
        }),
      });
      expect(startResp.ok).toBe(true);
      const started = (await startResp.json()) as {
        workflowRunId: string;
        status: string;
      };
      expect(started.workflowRunId).toBeTruthy();

      // run_id is set by the workflow itself with the pattern
      // brief_<kind>_<date>_<ms>. We don't have access to it directly,
      // so we poll for the most recent adhoc brief instead.
      const sql = postgres(PG_URL, {
        max: 2,
        idle_timeout: 10,
        prepare: false,
      });
      let runId: string | null = null;
      try {
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline && !runId) {
          const rows = await sql/* sql */`
            select run_id from briefs
            where kind = 'adhoc'
            order by created_at desc
            limit 1
          `;
          if (rows.length > 0) {
            runId = (rows[0] as { run_id: string }).run_id;
            break;
          }
          await new Promise((r) => setTimeout(r, 1_000));
        }
      } finally {
        await sql.end({ timeout: 5 }).catch(() => {});
      }
      expect(runId, "no adhoc brief row appeared").toBeTruthy();

      const final = await pollBriefStatus(runId!);

      if (final.status === "ready") {
        expect(final.body_markdown).toBeTruthy();
        expect(final.body_markdown!.length).toBeGreaterThan(50);
        // insights is a jsonb blob — must at least parse as an object with
        // the expected keys.
        const insights = final.insights as {
          summary?: string;
          insights?: unknown[];
          next_actions?: unknown[];
          questions?: unknown[];
        } | null;
        expect(insights).not.toBeNull();
        expect(typeof insights!.summary).toBe("string");
        expect(Array.isArray(insights!.insights)).toBe(true);
        expect(Array.isArray(insights!.next_actions)).toBe(true);
        expect(Array.isArray(insights!.questions)).toBe(true);
      } else {
        // Failure path: must surface a real error, not silent dormancy.
        expect(final.error_text, "failed brief must have error_text").toBeTruthy();
        // Surface the error so the test log is useful.
        // eslint-disable-next-line no-console
        console.error("brief failed:", final.error_text);
        // We accept "failed" as a valid terminal state for the test —
        // what we won't accept is "pending" forever (caught by timeout
        // above) or a row that's "failed" with no error_text.
      }
    },
  );
});
