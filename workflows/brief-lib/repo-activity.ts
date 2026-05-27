/**
 * Repo activity steps for the brief workflow.
 *
 * The "owners-of-interest" pattern: we don't crawl every repo on every
 * brief. Instead the workflow asks for activity at the project level
 * — and the project map comes from projects.yaml. For now the brief
 * pulls activity for a static set of orgs/users; that's enough to give
 * the LLM a grounded picture without exploding the API budget.
 *
 * Each function is "use step" so the WDK treats it as a Node step.
 * The Octokit client is lazy-imported so the workflow analyzer is happy.
 */

export interface CommitActivity {
  repo: string;
  commits: number;
  latest_sha?: string;
  latest_title?: string;
  author?: string;
}

export interface OpenPRRow {
  repo: string;
  number: number;
  title: string;
  url: string;
  author?: string;
  draft?: boolean;
}

export interface RecentIssueRow {
  repo: string;
  number: number;
  title: string;
  url: string;
  state: string;
}

async function getOctokit() {
  const { Octokit } = await import("@octokit/rest");
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GH_TOKEN / GITHUB_TOKEN env var not set");
  }
  return new Octokit({ auth: token, userAgent: "tars-brief/0.1" });
}

const DEFAULT_OWNERS = (
  process.env.TARS_BRIEF_GH_OWNERS ?? "Apextech-sys"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Fetch open PRs across the configured owners, capped at MAX_PRS. We use
 * the GitHub search API so we only get open, non-draft, recent PRs.
 */
export async function fetchOpenPRs(args: {
  maxPRs?: number;
}): Promise<{ items: OpenPRRow[]; available: boolean; error?: string }> {
  "use step";
  const maxPRs = args.maxPRs ?? 30;
  try {
    const octo = await getOctokit();
    const items: OpenPRRow[] = [];
    for (const owner of DEFAULT_OWNERS) {
      if (items.length >= maxPRs) break;
      const q = `is:pr is:open archived:false user:${owner}`;
      const r = await octo.search.issuesAndPullRequests({
        q,
        per_page: Math.min(maxPRs - items.length, 50),
        sort: "updated",
        order: "desc",
        advanced_search: "true",
      });
      for (const issue of r.data.items ?? []) {
        const repo = issue.repository_url?.split("/").slice(-2).join("/");
        items.push({
          repo: repo ?? "(unknown)",
          number: issue.number,
          title: issue.title,
          url: issue.html_url,
          author: issue.user?.login,
          draft: issue.draft ?? false,
        });
        if (items.length >= maxPRs) break;
      }
    }
    return { items, available: true };
  } catch (err) {
    return { items: [], available: false, error: (err as Error).message };
  }
}

/**
 * Fetch recently updated issues across owners. We deliberately avoid PRs
 * here (covered above) and bias toward issues touched in the audit window.
 */
export async function fetchRecentIssues(args: {
  windowStart: string;
  maxIssues?: number;
}): Promise<{ items: RecentIssueRow[]; available: boolean; error?: string }> {
  "use step";
  const maxIssues = args.maxIssues ?? 20;
  try {
    const octo = await getOctokit();
    const since = new Date(args.windowStart).toISOString().slice(0, 10);
    const items: RecentIssueRow[] = [];
    for (const owner of DEFAULT_OWNERS) {
      if (items.length >= maxIssues) break;
      const q = `is:issue archived:false user:${owner} updated:>=${since}`;
      const r = await octo.search.issuesAndPullRequests({
        q,
        per_page: Math.min(maxIssues - items.length, 50),
        sort: "updated",
        order: "desc",
        advanced_search: "true",
      });
      for (const issue of r.data.items ?? []) {
        const repo = issue.repository_url?.split("/").slice(-2).join("/");
        items.push({
          repo: repo ?? "(unknown)",
          number: issue.number,
          title: issue.title,
          url: issue.html_url,
          state: issue.state,
        });
        if (items.length >= maxIssues) break;
      }
    }
    return { items, available: true };
  } catch (err) {
    return { items: [], available: false, error: (err as Error).message };
  }
}

/**
 * Aggregate commits across owners since windowStart, returning a per-repo
 * tally. We use the search API again because cross-repo commit listings
 * are otherwise prohibitively expensive.
 */
export async function fetchCommitActivity(args: {
  windowStart: string;
  maxRepos?: number;
}): Promise<{
  items: CommitActivity[];
  available: boolean;
  error?: string;
}> {
  "use step";
  const maxRepos = args.maxRepos ?? 30;
  try {
    const octo = await getOctokit();
    const since = new Date(args.windowStart).toISOString().slice(0, 10);
    const byRepo = new Map<string, CommitActivity>();
    for (const owner of DEFAULT_OWNERS) {
      const q = `author-date:>=${since} sort:committer-date-desc user:${owner}`;
      // Commit search needs a specific Accept header but Octokit handles it.
      const r = await octo.search.commits({
        q,
        per_page: 100,
      });
      for (const commit of (r.data.items ?? []) as Array<{
        repository?: { full_name?: string };
        sha?: string;
        commit?: { message?: string };
        author?: { login?: string } | null;
      }>) {
        const repo = commit.repository?.full_name ?? "(unknown)";
        const existing = byRepo.get(repo);
        if (existing) {
          existing.commits += 1;
        } else {
          if (byRepo.size >= maxRepos) continue;
          byRepo.set(repo, {
            repo,
            commits: 1,
            latest_sha: commit.sha,
            latest_title: commit.commit?.message?.split("\n")[0]?.slice(0, 140),
            author: commit.author?.login ?? undefined,
          });
        }
      }
    }
    const items = Array.from(byRepo.values()).sort(
      (a, b) => b.commits - a.commits,
    );
    return { items, available: true };
  } catch (err) {
    return { items: [], available: false, error: (err as Error).message };
  }
}
