/**
 * Octokit wrappers for the PR review workflow.
 *
 * Every exported function carries a `"use step"` directive so the WDK compiler
 * treats it as a step — these functions run in a regular Node context and may
 * use fs, child_process, octokit, etc. The workflow function calls them as
 * if they were async functions; the WDK arranges durable retry semantics.
 *
 * Auth: GH_TOKEN env var. The token is authed as `Apextech-sys`.
 */

// All Node.js + Octokit imports are lazy (inside step functions) so the WDK
// static analyzer doesn't reject them when this file is imported from the
// workflow side. Each exported function carries `"use step"`.

// (no static imports — everything is lazy inside the steps below)

async function getOctokit() {
  const { Octokit } = await import("@octokit/rest");
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GH_TOKEN / GITHUB_TOKEN env var not set");
  }
  return new Octokit({ auth: token, userAgent: "tars-pr-review/0.1" });
}

export interface PrInfo {
  number: number;
  title: string;
  body: string;
  state: string;
  baseRef: string;
  headRef: string;
  headSha: string;
  user: string;
  draft: boolean;
  changedFiles: number;
  additions: number;
  deletions: number;
  url: string;
}

export async function fetchPR(
  owner: string,
  repo: string,
  prNumber: number
): Promise<PrInfo> {
  "use step";
  const octo = await getOctokit();
  const { data } = await octo.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });
  return {
    number: data.number,
    title: data.title,
    body: data.body ?? "",
    state: data.state,
    baseRef: data.base.ref,
    headRef: data.head.ref,
    headSha: data.head.sha,
    user: data.user?.login ?? "",
    draft: data.draft ?? false,
    changedFiles: data.changed_files,
    additions: data.additions,
    deletions: data.deletions,
    url: data.html_url,
  };
}

export interface PrFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export async function fetchPRFiles(
  owner: string,
  repo: string,
  prNumber: number
): Promise<PrFile[]> {
  "use step";
  const octo = await getOctokit();
  const files: PrFile[] = [];
  for await (const resp of octo.paginate.iterator(octo.pulls.listFiles, {
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  })) {
    for (const f of resp.data) {
      files.push({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch,
      });
    }
  }
  return files;
}

/**
 * Fetch the unified diff for a PR.
 *
 * GitHub's diff endpoint returns 422 with code "too_large" when the PR
 * touches > ~300 files. In that case we fall back to synthesizing a
 * diff from per-file patches obtained from `listFiles`. The synthesized
 * diff is functionally equivalent for code-review purposes (per-hunk
 * patches are preserved); only the unified-diff envelope changes.
 *
 * Also caps the result at ~1.5 MB to avoid OOM'ing the AI reviewers.
 */
export async function fetchPRDiff(
  owner: string,
  repo: string,
  prNumber: number
): Promise<string> {
  "use step";
  const MAX_DIFF_BYTES = 1_500_000; // ~1.5 MB cap (Anthropic ~200k token ceiling for context)
  const octo = await getOctokit();

  // Try the native diff endpoint first.
  try {
    const resp = await octo.request(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}",
      {
        owner,
        repo,
        pull_number: prNumber,
        mediaType: { format: "diff" },
      }
    );
    const diff =
      typeof resp.data === "string" ? resp.data : String(resp.data ?? "");
    if (diff.length > MAX_DIFF_BYTES) {
      return (
        diff.slice(0, MAX_DIFF_BYTES) +
        `\n\n[diff truncated — original ${diff.length} bytes, kept first ${MAX_DIFF_BYTES} bytes]`
      );
    }
    return diff;
  } catch (err: unknown) {
    const e = err as {
      status?: number;
      message?: string;
      response?: { data?: { errors?: Array<{ code?: string }> } };
    };
    const isTooLarge =
      e?.status === 422 &&
      (e?.message?.includes("too_large") ||
        e?.message?.includes("maximum number of files") ||
        e?.response?.data?.errors?.some((x) => x?.code === "too_large"));
    if (!isTooLarge) {
      throw err;
    }
    // Fall through to synthesized diff.
  }

  // Synthesize a unified diff from per-file patches.
  const files: Array<{
    filename: string;
    status: string;
    patch?: string;
    additions: number;
    deletions: number;
  }> = [];
  for await (const resp of octo.paginate.iterator(octo.pulls.listFiles, {
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  })) {
    for (const f of resp.data) {
      files.push({
        filename: f.filename,
        status: f.status,
        patch: f.patch,
        additions: f.additions,
        deletions: f.deletions,
      });
    }
  }

  const sections: string[] = [];
  sections.push(
    `# Synthesized diff — original diff exceeded GitHub's 300-file limit.\n# ${files.length} files changed.\n`
  );
  let bytesUsed = sections[0].length;
  let truncated = false;
  for (const f of files) {
    const header = `diff --git a/${f.filename} b/${f.filename}\n--- a/${f.filename}\n+++ b/${f.filename}\n`;
    const body = f.patch ?? `# (no patch available — status=${f.status}, +${f.additions}/-${f.deletions})\n`;
    const section = header + body + "\n";
    if (bytesUsed + section.length > MAX_DIFF_BYTES) {
      truncated = true;
      break;
    }
    sections.push(section);
    bytesUsed += section.length;
  }
  if (truncated) {
    sections.push(
      `\n[synthesized diff truncated at ~${MAX_DIFF_BYTES} bytes — ${files.length} total files in PR]\n`
    );
  }
  return sections.join("");
}

export interface PostPrCommentResult {
  url: string;
  id: number;
}

export async function postPRComment(
  owner: string,
  repo: string,
  prNumber: number,
  body: string
): Promise<PostPrCommentResult> {
  "use step";
  const octo = await getOctokit();
  const { data } = await octo.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body,
  });
  return { url: data.html_url, id: data.id };
}

export async function createIssue(
  owner: string,
  repo: string,
  title: string,
  body: string,
  labels: string[] = []
): Promise<{ url: string; number: number }> {
  "use step";
  const octo = await getOctokit();
  const { data } = await octo.issues.create({
    owner,
    repo,
    title,
    body,
    labels,
  });
  return { url: data.html_url, number: data.number };
}

export async function listOpenPRsTouchingPaths(
  owner: string,
  repo: string,
  paths: string[]
): Promise<number[]> {
  "use step";
  if (paths.length === 0) {
    return [];
  }
  const octo = await getOctokit();
  const { data } = await octo.pulls.list({
    owner,
    repo,
    state: "open",
    per_page: 100,
  });
  const results: number[] = [];
  for (const pr of data) {
    try {
      const files: PrFile[] = [];
      for await (const resp of octo.paginate.iterator(octo.pulls.listFiles, {
        owner,
        repo,
        pull_number: pr.number,
        per_page: 100,
      })) {
        for (const f of resp.data) {
          files.push({
            filename: f.filename,
            status: f.status,
            additions: f.additions,
            deletions: f.deletions,
            patch: f.patch,
          });
        }
      }
      const fileSet = new Set(files.map((f) => f.filename));
      if (paths.some((p) => fileSet.has(p))) {
        results.push(pr.number);
      }
    } catch {
      // skip on error
    }
  }
  return results;
}

export async function fetchCodeowners(
  owner: string,
  repo: string,
  ref?: string
): Promise<string> {
  "use step";
  const octo = await getOctokit();
  const candidates = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];
  for (const p of candidates) {
    try {
      const { data } = await octo.repos.getContent({
        owner,
        repo,
        path: p,
        ref,
      });
      if (!Array.isArray(data) && data.type === "file" && "content" in data) {
        return Buffer.from(data.content, "base64").toString("utf8");
      }
    } catch {
      // try next
    }
  }
  return "";
}

export interface ApplyAndPushResult {
  branch: string;
  commitSha: string;
  prUrl?: string;
}

export async function applyAndPushPatch(args: {
  owner: string;
  repo: string;
  baseSha: string;
  branch: string;
  patch: string;
  commitMessage: string;
}): Promise<ApplyAndPushResult> {
  "use step";
  const { execFile } = await import("node:child_process");
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  const { owner, repo, baseSha, branch, patch, commitMessage } = args;
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GH_TOKEN env var not set");
  }
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tars-fix-"));
  const cloneUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  try {
    await execFileAsync(
      "git",
      ["clone", "--depth", "50", cloneUrl, tmp],
      { timeout: 120_000 }
    );
    await execFileAsync("git", ["-C", tmp, "checkout", baseSha], {
      timeout: 30_000,
    });
    await execFileAsync("git", ["-C", tmp, "checkout", "-b", branch], {
      timeout: 30_000,
    });
    const patchPath = path.join(tmp, ".tars.patch");
    await fs.writeFile(patchPath, patch, "utf8");
    await execFileAsync(
      "git",
      ["-C", tmp, "apply", "--whitespace=nowarn", patchPath],
      { timeout: 30_000 }
    );
    await execFileAsync("git", ["-C", tmp, "add", "-A"], { timeout: 30_000 });
    await execFileAsync(
      "git",
      [
        "-C",
        tmp,
        "-c",
        "user.email=tars@apextech.local",
        "-c",
        "user.name=TARS Bot",
        "commit",
        "-m",
        commitMessage,
      ],
      { timeout: 30_000 }
    );
    const { stdout: shaOut } = await execFileAsync(
      "git",
      ["-C", tmp, "rev-parse", "HEAD"],
      { timeout: 10_000 }
    );
    const commitSha = shaOut.trim();
    await execFileAsync("git", ["-C", tmp, "push", "origin", branch], {
      timeout: 60_000,
    });
    return { branch, commitSha };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}
