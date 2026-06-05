/**
 * GitHub webhook lifecycle for the repos TARS reviews.
 *
 * TARS reviews a repo only when (a) the repo has a GitHub webhook pointing at
 * our ingress and (b) `repo_settings.webhook_enabled` is true. Historically the
 * hook was created out-of-band (a shell script) and its id was never persisted
 * to `repo_settings.github_hook_id`, so the app couldn't manage or even show
 * the hook (and disabling a repo in Settings left the GitHub hook live). These
 * helpers make the hook a first-class, app-managed resource: the id is always
 * captured on create, and the Settings toggle creates/deletes the real hook.
 *
 * Auth: the shared Octokit (GH_TOKEN / GITHUB_TOKEN) used across the app.
 */
import { getOctokit } from "@/lib/pr-review/github-client";

const TRAILING_SLASH = /\/$/;

/** The TARS webhook ingress URL (env-overridable; correct prod default). */
export function tarsWebhookUrl(): string {
  const base = (
    process.env.TARS_PUBLIC_URL ?? "https://tars.reflexconnect.co.za"
  ).replace(TRAILING_SLASH, "");
  return `${base}/api/webhooks/github`;
}

/** Return the id of the existing TARS hook on a repo, or null if none. */
export async function findTarsHookId(
  owner: string,
  repo: string
): Promise<number | null> {
  const octokit = await getOctokit();
  const url = tarsWebhookUrl();
  const hooks = await octokit.repos.listWebhooks({
    owner,
    repo,
    per_page: 100,
  });
  const match = hooks.data.find((h) => h.config?.url === url);
  return match ? match.id : null;
}

/**
 * Ensure a TARS webhook exists on the repo and return its id. Idempotent:
 * reuses an existing hook (matched by config.url) instead of duplicating.
 */
export async function ensureTarsHook(
  owner: string,
  repo: string
): Promise<number> {
  const existing = await findTarsHookId(owner, repo);
  if (existing !== null) {
    return existing;
  }
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("GITHUB_WEBHOOK_SECRET not set — cannot create webhook");
  }
  const octokit = await getOctokit();
  const created = await octokit.repos.createWebhook({
    owner,
    repo,
    name: "web",
    active: true,
    events: ["pull_request", "push"],
    config: {
      url: tarsWebhookUrl(),
      content_type: "json",
      secret,
      insecure_ssl: "0",
    },
  });
  return created.data.id;
}

/** Delete a TARS webhook from the repo (best-effort; throws on API failure). */
export async function deleteTarsHook(
  owner: string,
  repo: string,
  hookId: number
): Promise<void> {
  const octokit = await getOctokit();
  await octokit.repos.deleteWebhook({ owner, repo, hook_id: hookId });
}
