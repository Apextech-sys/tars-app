import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stageFixChanges } from "../../src/handlers/claude-fix-apply.js";

/**
 * Staging proof (the `-am` burn-in): the fix stage used `git commit -am`, which
 * stages only tracked-MODIFIED files. Any NEW file the fix agent created — most
 * importantly the Stage-10b regression test — was untracked, never committed,
 * and therefore ABSENT from the fix PR. That silently defeated "expand the test
 * suite": the PR shipped the code fix without the test.
 *
 * stageFixChanges must stage modified + NEW + deleted (`git add -A`), exclude
 * the handler's scratch artifacts, and report accounting from the INDEX so the
 * new file is COUNTED. This test builds a real throwaway git repo and proves it.
 */

const ONE_FILE_CHANGED_RE = /1 file changed/;
const INSERTION_RE = /insertion/;

function gitRun(cwd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd });
    let err = "";
    child.stderr.on("data", (b) => {
      err += String(b);
    });
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`git ${args.join(" ")} (exit ${code}): ${err}`))
    );
    child.on("error", reject);
  });
}

async function initRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tars-stage-test-"));
  await gitRun(dir, ["init", "-q"]);
  await gitRun(dir, ["config", "user.email", "t@t"]);
  await gitRun(dir, ["config", "user.name", "t"]);
  await gitRun(dir, ["config", "commit.gpgsign", "false"]);
  // Seed a tracked file so we have something to MODIFY (vs only adding new).
  await writeFile(join(dir, "src.ts"), "export const x = 1;\n", "utf8");
  await gitRun(dir, ["add", "-A"]);
  await gitRun(dir, ["commit", "-q", "-m", "init"]);
  return dir;
}

describe("stageFixChanges", () => {
  let repo: string;

  beforeEach(async () => {
    repo = await initRepo();
  });
  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it("stages a NEW (untracked) file — the regression that `-am` silently dropped", async () => {
    // Simulate the agent: modify a tracked file AND create a brand-new test.
    await writeFile(join(repo, "src.ts"), "export const x = 2;\n", "utf8");
    await writeFile(
      join(repo, "src.regression.test.ts"),
      "import { expect, it } from 'vitest';\nit('x', () => expect(1).toBe(1));\n",
      "utf8"
    );

    const { filesChanged } = await stageFixChanges(repo);

    // BOTH the modified source AND the new test must be staged/counted.
    expect(filesChanged).toContain("src.ts");
    expect(filesChanged).toContain("src.regression.test.ts");
  });

  it("excludes the handler's scratch artifacts from what gets committed", async () => {
    await writeFile(join(repo, "src.ts"), "export const x = 3;\n", "utf8");
    // Defensive case: a scratch file written INTO the repo dir must NOT leak.
    for (const name of [
      "tars-fix-report.json",
      ".tars-fix-report.json",
      "tars-test-report.json",
      ".tars-test-report.json",
    ]) {
      await writeFile(join(repo, name), "{}", "utf8");
    }

    const { filesChanged } = await stageFixChanges(repo);

    expect(filesChanged).toContain("src.ts");
    for (const name of filesChanged) {
      expect(name).not.toContain("tars-fix-report.json");
      expect(name).not.toContain("tars-test-report.json");
    }
  });

  it("reports a non-empty shortstat that reflects the new file", async () => {
    await writeFile(
      join(repo, "added.ts"),
      "export const added = true;\n",
      "utf8"
    );

    const { filesChanged, shortstat } = await stageFixChanges(repo);

    expect(filesChanged).toContain("added.ts");
    // `git diff --cached --shortstat` counts the staged new file's insertions.
    expect(shortstat).toMatch(ONE_FILE_CHANGED_RE);
    expect(shortstat).toMatch(INSERTION_RE);
  });
});
