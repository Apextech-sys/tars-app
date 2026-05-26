/**
 * End-to-end integration test for the PR review workflow.
 *
 * GATED on RUN_INTEGRATION=1 — does not run by default. When enabled it WILL
 * make real GitHub API calls and (if dryRun=false) post a real comment to:
 *
 *   https://github.com/Apextech-sys/polymarket-v2/pull/114
 *
 * Architecture:
 *   - This test cannot call prReviewWorkflow() directly: createHook() throws
 *     unless invoked inside the workflow runtime. So we POST to the tars-app
 *     server at TARS_APP_URL (default http://localhost:3001), which calls
 *     `start(prReviewWorkflow, [...])` inside the Next.js process where the
 *     WDK is wired up via withWorkflow(...).
 *   - Then we poll /api/tars/pr-review/status until the row in pr_review_runs
 *     reaches a terminal status.
 *
 * Required for "completed" status: a worker (M3) or the simulator at
 * scripts/tars-worker-simulator.ts must be running to process tars_jobs.
 */

import { describe, it, expect } from "vitest";

const RUN = process.env.RUN_INTEGRATION === "1";
const TARS_APP_URL =
  process.env.TARS_APP_URL ?? "http://localhost:3001";
const POLL_INTERVAL_MS = 5_000;
const MAX_WAIT_MS = 12 * 60_000; // 12 minutes

const OWNER = process.env.TARS_TEST_OWNER ?? "Apextech-sys";
const REPO = process.env.TARS_TEST_REPO ?? "polymarket-v2";
const PR_NUMBER = Number(process.env.TARS_TEST_PR ?? "114");
const DRY_RUN = process.env.TARS_TEST_DRY_RUN === "1";

interface StatusRow {
  run_id: string;
  status: string;
  pr_sha: string | null;
  findings_count: number;
  review_comment_url: string | null;
  error: string | null;
  updated_at: string;
}

async function pollStatus(): Promise<StatusRow> {
  const url = `${TARS_APP_URL}/api/tars/pr-review/status?owner=${encodeURIComponent(
    OWNER
  )}&repo=${encodeURIComponent(REPO)}&prNumber=${PR_NUMBER}`;
  const started = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const resp = await fetch(url);
    if (resp.ok) {
      const row = (await resp.json()) as StatusRow;
      const terminal = [
        "completed",
        "skipped-disagreement",
        "skipped-no-findings",
        "skipped-policy",
        "blocked-konverge",
        "error",
      ].includes(row.status);
      if (terminal) {
        return row;
      }
    }
    if (Date.now() - started > MAX_WAIT_MS) {
      throw new Error(
        `Workflow did not reach terminal status within ${MAX_WAIT_MS}ms (last poll url=${url})`
      );
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

describe.skipIf(!RUN)(
  "PR review workflow — live PR (tars-app HTTP)",
  () => {
    it(
      `runs end-to-end against ${OWNER}/${REPO}#${PR_NUMBER} and reaches terminal status`,
      { timeout: MAX_WAIT_MS + 60_000 },
      async () => {
        const startResp = await fetch(`${TARS_APP_URL}/api/tars/pr-review`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            owner: OWNER,
            repo: REPO,
            prNumber: PR_NUMBER,
            authToken: process.env.TARS_INTERNAL_SECRET ?? undefined,
            dryRun: DRY_RUN,
            policyOverride: {
              autoFix: false,
              autoReview: true,
              issueTracker: "none",
              slackNotify: false,
              protectMode: false,
              severityThreshold: "minor",
            },
          }),
        });
        const startBody = await startResp.json().catch(() => ({}));
        expect(startResp.ok, `start failed: ${JSON.stringify(startBody)}`).toBe(true);

        const final = await pollStatus();

        expect([
          "completed",
          "skipped-disagreement",
          "skipped-no-findings",
        ]).toContain(final.status);

        if (final.status === "completed" && !DRY_RUN) {
          expect(final.review_comment_url).toBeTruthy();
          expect(final.review_comment_url).toMatch(
            new RegExp(
              `^https://github\\.com/${OWNER}/${REPO}/pull/${PR_NUMBER}`,
              "i"
            )
          );
        }
      }
    );
  }
);
