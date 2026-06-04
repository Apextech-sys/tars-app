/**
 * One-off backfill: populate pr_review_runs.pr_title / pr_author for historical
 * rows that pre-date the on-the-run capture (drizzle/0016).
 *
 * For each run missing a title we fetch the PR from GitHub
 * (GET /repos/{owner}/{repo}/pulls/{prNumber}) using the app's existing GitHub
 * auth (GH_TOKEN ?? GITHUB_TOKEN — same token the PR-review workflow uses to
 * post review comments) and store title + author.login.
 *
 * Safe + idempotent:
 *   - only touches rows where pr_title IS NULL, so re-running is a no-op once
 *     populated;
 *   - ensures the columns exist first (ADD COLUMN IF NOT EXISTS), so it runs
 *     standalone even on a DB where the migration / workflow self-heal hasn't
 *     applied them yet;
 *   - a deleted/inaccessible PR (404) is logged and skipped, not fatal.
 *
 * Run once on the host:
 *   GH_TOKEN=… DATABASE_URL=… pnpm tsx scripts/backfill-pr-titles.ts
 */

import { Octokit } from "@octokit/rest";
import postgres from "postgres";

interface RunRow {
  run_id: string;
  owner: string;
  repo: string;
  pr_number: number;
}

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL ?? process.env.WORKFLOW_POSTGRES_URL;
  if (!dbUrl) {
    throw new Error("DATABASE_URL / WORKFLOW_POSTGRES_URL not set");
  }
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GH_TOKEN / GITHUB_TOKEN not set");
  }

  const sql = postgres(dbUrl, { max: 2, idle_timeout: 20, prepare: false });
  const octo = new Octokit({ auth: token, userAgent: "tars-backfill/0.1" });

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  try {
    // Self-heal the columns so the script is independent of migration order.
    await sql`
      alter table pr_review_runs
        add column if not exists pr_title text,
        add column if not exists pr_author text;
    `;

    const rows = (await sql`
      select run_id, owner, repo, pr_number
      from pr_review_runs
      where pr_title is null
      order by created_at asc
    `) as unknown as RunRow[];

    console.log(`[backfill] ${rows.length} run(s) missing pr_title`);

    // Cache per (owner/repo/prNumber) so multiple runs on the same PR only hit
    // the GitHub API once.
    const cache = new Map<
      string,
      { title: string; author: string | null } | null
    >();

    for (const r of rows) {
      const key = `${r.owner}/${r.repo}#${r.pr_number}`;
      let info = cache.get(key);
      if (info === undefined) {
        try {
          const { data } = await octo.pulls.get({
            owner: r.owner,
            repo: r.repo,
            pull_number: r.pr_number,
          });
          info = { title: data.title, author: data.user?.login ?? null };
        } catch (err) {
          const status = (err as { status?: number }).status;
          console.warn(
            `[backfill] ${key}: GitHub fetch failed (status=${status ?? "?"}) — skipping`
          );
          info = null;
          failed += 1;
        }
        cache.set(key, info);
      }

      if (!info) {
        skipped += 1;
        continue;
      }

      await sql`
        update pr_review_runs
        set pr_title = ${info.title},
            pr_author = ${info.author}
        where run_id = ${r.run_id} and pr_title is null
      `;
      updated += 1;
      console.log(`[backfill] ${r.run_id} <- ${JSON.stringify(info.title)}`);
    }

    console.log(
      `[backfill] done: updated=${updated} skipped=${skipped} failed_fetches=${failed}`
    );
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {
      // best-effort pool shutdown
    });
  }
}

main().catch((err) => {
  console.error("[backfill] fatal:", err);
  process.exit(1);
});
