/**
 * Plain Octokit helpers for use from Next.js route handlers.
 *
 * Mirrors the auth pattern of `workflows/lib/gh.ts` (GH_TOKEN / GITHUB_TOKEN
 * env var, `Apextech-sys` user-agent), but without the `"use step"` directive
 * so it's safe to import from server-side application code outside the WDK
 * compilation boundary.
 */

import type { Octokit as OctokitType } from "@octokit/rest";

let cachedOctokit: OctokitType | null = null;

export async function getOctokit(): Promise<OctokitType> {
  if (cachedOctokit) {
    return cachedOctokit;
  }
  const { Octokit } = await import("@octokit/rest");
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GH_TOKEN / GITHUB_TOKEN env var not set");
  }
  cachedOctokit = new Octokit({ auth: token, userAgent: "tars-pr-review/0.1" });
  return cachedOctokit;
}

export interface PostPrCommentResult {
  url: string;
  id: number;
}

export async function postPRCommentDirect(
  owner: string,
  repo: string,
  prNumber: number,
  body: string
): Promise<PostPrCommentResult> {
  const octo = await getOctokit();
  const { data } = await octo.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body,
  });
  return { url: data.html_url, id: data.id };
}
