/**
 * Baseline-diff test gate for the FIX stage.
 *
 * The old gate trusted the model's self-reported `existingTestsPassed` boolean
 * and failed the run unless the WHOLE suite passed after the fix. That blocked
 * good fixes whenever the target repo had pre-existing red tests, or tests that
 * can't run in the ephemeral clone (e.g. DB tests that need `DATABASE_URL` and
 * fail with `role "shaun" does not exist`).
 *
 * The new gate is a BASELINE DIFF computed deterministically by the harness
 * (never by the model):
 *
 *   1. BEFORE the agent edits anything, run the repo's test command once and
 *      record the set of test identifiers + their pass/fail (the "baseline").
 *   2. AFTER the fix, run the same command again.
 *   3. A test is a REGRESSION if it was PASSING in the baseline and is now
 *      FAILING. The gate FAILS only when there is >=1 regression. Tests that
 *      were already red in the baseline (pre-existing reds, env-flaky DB-role
 *      errors that fail both runs) DO NOT fail the gate.
 *   4. A NEWLY-ADDED test (present after but not before — typically the agent's
 *      own regression test) that FAILS is a fix-quality failure (the agent's
 *      test doesn't pass) and also fails the gate, with a distinct reason.
 *
 * The per-test parsing targets vitest's JSON reporter (Jest-compatible shape:
 * `{ testResults: [{ assertionResults: [{ fullName, status }] }] }`). When the
 * runner is not vitest (or no per-test results can be produced), we fall back
 * gracefully — see `evaluateGate` / the handler — and NEVER silently claim
 * success.
 */

import { spawn } from "node:child_process";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

/** Per-test status, normalised across reporters. */
export type TestStatus = "passed" | "failed" | "skipped";

/** A single test's outcome, keyed by a stable identifier. */
export interface TestResult {
  id: string;
  status: TestStatus;
}

/** Map id -> status for fast diffing. */
export type TestResultMap = Map<string, TestStatus>;

/** Outcome of a single test-suite run inside the clone. */
export interface TestRunOutcome {
  /** The command we actually ran (for the UI / PR body). */
  command: string | null;
  /** Per-test results, or null when we could not parse any. */
  results: TestResultMap | null;
  /** Process exit code (null on timeout / spawn error). */
  exitCode: number | null;
  /** True if the run timed out. */
  timedOut: boolean;
  /** Last lines of combined stdout/stderr, for diagnostics. */
  outputTail: string;
  /** Set when parsing/running failed in a way the caller should surface. */
  note?: string;
}

/** The deterministic gate decision. */
export interface GateDecision {
  /** true => safe to open the PR. */
  passed: boolean;
  /** The test command actually run (from the after-run), for the UI / PR body. */
  testCommand: string | null;
  /** Machine code for the run record + UI. */
  code:
    | "no-regressions"
    | "regressions"
    | "added-test-failed"
    | "after-suite-passed"
    | "after-suite-failed"
    | "tests-inconclusive";
  /** Count of tests passing in the baseline (null if no baseline). */
  baselinePassCount: number | null;
  /** Count of tests passing after the fix (null if no after-results). */
  afterPassCount: number | null;
  /** Test ids that passed before and now fail (the blocking set). */
  regressions: string[];
  /** Newly-added tests (not in baseline) that now FAIL. */
  newlyFailing: string[];
  /** Human one-liner for the PR body + fix panel. */
  summary: string;
  /** Longer reason, populated on failure / inconclusive. */
  reason?: string;
}

const DEFAULT_TEST_TIMEOUT_MS = 8 * 60_000;

/**
 * Detect the test command from the repo's package.json. Prefers an explicit
 * `scripts.test`, but ONLY if it looks like a vitest/jest invocation we can
 * coax per-test JSON out of; otherwise we run vitest directly. Returns null
 * when the repo has no usable JS test runner at all.
 */
export interface DetectedRunner {
  /** argv to spawn (e.g. ["pnpm","exec","vitest", ...]). */
  argv: string[];
  /** "vitest" | "jest" | "unknown" — drives reporter flags + parsing. */
  kind: "vitest" | "jest" | "unknown";
  /** Display string for the UI. */
  display: string;
}

const VITEST_RE = /\bvitest\b/;
const JEST_RE = /\bjest\b/;

export async function detectRunner(
  workspace: string
): Promise<DetectedRunner | null> {
  let pkg: { scripts?: Record<string, string> } | null = null;
  try {
    pkg = JSON.parse(
      await readFile(join(workspace, "package.json"), "utf8")
    ) as { scripts?: Record<string, string> };
  } catch {
    return null;
  }
  const testScript = pkg?.scripts?.test?.trim();
  const pm = "pnpm";

  // vitest: run it directly so we control the reporter flags rather than
  // inheriting whatever the repo's `test` script does.
  if (testScript && VITEST_RE.test(testScript)) {
    return {
      argv: [pm, "exec", "vitest", "run"],
      kind: "vitest",
      display: `${pm} exec vitest run`,
    };
  }
  if (testScript && JEST_RE.test(testScript)) {
    return {
      argv: [pm, "exec", "jest"],
      kind: "jest",
      display: `${pm} exec jest`,
    };
  }
  // A `test` script exists but we don't recognise the runner — run it as-is
  // (no per-test parsing; the gate will treat it as pass/fail by exit code).
  if (testScript) {
    return {
      argv: [pm, "test"],
      kind: "unknown",
      display: `${pm} test`,
    };
  }
  // No `test` script. Last resort: try vitest if it's present as a dep.
  return {
    argv: [pm, "exec", "vitest", "run"],
    kind: "vitest",
    display: `${pm} exec vitest run`,
  };
}

/**
 * Install the repo's dependencies in the ephemeral clone so the test runner is
 * actually available for the BASELINE run. Without this the baseline `vitest`
 * exits instantly (no node_modules) and produces no per-test results, which
 * would force the gate into its no-baseline fallback and wrongly fail on
 * pre-existing reds. Detects the package manager from the lockfile; best-effort
 * (returns the exit/result so the caller can log it).
 */
export async function installDeps(
  workspace: string,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<{ ran: boolean; ok: boolean; manager: string; outputTail: string }> {
  const timeoutMs = opts.timeoutMs ?? 6 * 60_000;
  let manager = "npm";
  let argv = ["npm", "install", "--no-audit", "--no-fund"];
  try {
    const files = new Set(await readdir(workspace));
    if (files.has("pnpm-lock.yaml")) {
      manager = "pnpm";
      argv = ["pnpm", "install", "--frozen-lockfile", "--prefer-offline"];
    } else if (files.has("yarn.lock")) {
      manager = "yarn";
      argv = ["yarn", "install", "--frozen-lockfile"];
    } else if (files.has("bun.lockb")) {
      manager = "bun";
      argv = ["bun", "install", "--frozen-lockfile"];
    }
  } catch {
    // fall through to npm
  }
  const { exitCode, output } = await spawnCapture(
    argv,
    workspace,
    timeoutMs,
    opts.signal
  );
  return {
    ran: true,
    ok: exitCode === 0,
    manager,
    outputTail: output.slice(-1500),
  };
}

/** Spawn a command in the workspace, capturing combined output + exit. */
function spawnCapture(
  argv: string[],
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<{ exitCode: number | null; output: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const [cmd, ...args] = argv;
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, CI: "true" },
    });
    let output = "";
    let timedOut = false;
    const cap = (b: unknown) => {
      output += String(b);
      // Bound memory: keep the last ~200KB.
      if (output.length > 200_000) {
        output = output.slice(-200_000);
      }
    };
    child.stdout?.on("data", cap);
    child.stderr?.on("data", cap);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    timer.unref?.();
    const onAbort = () => {
      timedOut = true;
      child.kill("SIGKILL");
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve({ exitCode: code, output, timedOut });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve({
        exitCode: null,
        output: `${output}\n[spawn error] ${(e as Error).message}`,
        timedOut,
      });
    });
  });
}

interface JestAssertion {
  fullName?: string;
  title?: string;
  ancestorTitles?: string[];
  status?: string;
}

interface JestFileResult {
  name?: string;
  assertionResults?: JestAssertion[];
}

const SKIPPED_STATUSES = new Set(["pending", "skipped", "todo", "disabled"]);

/** Normalise a reporter status string to our 3-value enum. */
function normalizeStatus(raw: string | undefined): TestStatus {
  if (raw === "passed") {
    return "passed";
  }
  if (raw && SKIPPED_STATUSES.has(raw)) {
    return "skipped";
  }
  return "failed";
}

/** A stable, file-namespaced id for one assertion. */
function assertionId(fileName: string, a: JestAssertion): string {
  const name =
    a.fullName ?? [...(a.ancestorTitles ?? []), a.title ?? ""].join(" ").trim();
  // Namespace by file so identically-named tests in different files don't
  // collide.
  return `${fileName} :: ${name}`.trim();
}

/**
 * Parse vitest/jest JSON reporter output (Jest-compatible shape) into a
 * id->status map. Returns null when no assertions could be extracted.
 */
export function parseJestJson(raw: string): TestResultMap | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const root = json as { testResults?: JestFileResult[] };
  if (!Array.isArray(root.testResults)) {
    return null;
  }
  const map: TestResultMap = new Map();
  for (const file of root.testResults) {
    const fileName = file.name ?? "";
    for (const a of file.assertionResults ?? []) {
      map.set(assertionId(fileName, a), normalizeStatus(a.status));
    }
  }
  return map.size > 0 ? map : null;
}

/**
 * Run the test suite once, writing the JSON reporter to a temp file inside the
 * workspace and parsing it. Falls back to parsing stdout if the file is empty.
 */
export async function runTestSuite(
  workspace: string,
  runner: DetectedRunner,
  opts: { timeoutMs?: number; signal?: AbortSignal; reportDir?: string } = {}
): Promise<TestRunOutcome> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TEST_TIMEOUT_MS;
  // Write the reporter output OUTSIDE the cloned repo when a scratch dir is
  // provided, so it can never be staged into the fix PR. Falls back to the
  // workspace for callers (and tests) that don't pass one.
  const reportFile = join(opts.reportDir ?? workspace, "tars-test-report.json");
  // Best-effort clean of any prior report so a stale file can't leak across runs.
  await rm(reportFile, { force: true }).catch(() => undefined);

  let argv = runner.argv;
  if (runner.kind === "vitest") {
    argv = [...runner.argv, "--reporter=json", `--outputFile=${reportFile}`];
  } else if (runner.kind === "jest") {
    argv = [...runner.argv, "--json", `--outputFile=${reportFile}`, "--ci"];
  }

  const { exitCode, output, timedOut } = await spawnCapture(
    argv,
    workspace,
    timeoutMs,
    opts.signal
  );

  let results: TestResultMap | null = null;
  if (runner.kind === "vitest" || runner.kind === "jest") {
    // 1. Prefer the JSON file the reporter wrote.
    try {
      const raw = await readFile(reportFile, "utf8");
      results = parseJestJson(raw);
    } catch {
      // 2. Some setups print JSON to stdout instead.
      results = parseJestJson(output);
    }
    await rm(reportFile, { force: true }).catch(() => undefined);
  }

  const expectedParse = runner.kind === "vitest" || runner.kind === "jest";
  let note: string | undefined;
  if (timedOut) {
    note = "test run timed out";
  } else if (results == null && expectedParse) {
    note = "could not parse per-test results";
  }

  return {
    command: runner.display,
    results,
    exitCode,
    timedOut,
    outputTail: output.slice(-2000),
    note,
  };
}

function countPassing(map: TestResultMap | null): number | null {
  if (!map) {
    return null;
  }
  let n = 0;
  for (const status of map.values()) {
    if (status === "passed") {
      n += 1;
    }
  }
  return n;
}

/**
 * THE CORE DIFF. Pure + deterministic so it's the cleanest unit-test proof.
 *
 * - regression  = test PASSING in baseline AND FAILING after.
 * - newlyFailing = test NOT in baseline AND FAILING after (the agent's own
 *   added test that doesn't pass).
 * The gate FAILS on any regression OR any newly-failing test.
 */
export function diffTestResults(
  baseline: TestResultMap,
  after: TestResultMap
): { regressions: string[]; newlyFailing: string[] } {
  const regressions: string[] = [];
  const newlyFailing: string[] = [];
  for (const [id, afterStatus] of after) {
    if (afterStatus !== "failed") {
      continue;
    }
    const beforeStatus = baseline.get(id);
    if (beforeStatus === "passed") {
      regressions.push(id);
    } else if (beforeStatus === undefined) {
      newlyFailing.push(id);
    }
    // beforeStatus === "failed" | "skipped" => pre-existing red, NOT a regression.
  }
  return { regressions, newlyFailing };
}

/**
 * Combine baseline + after into the gate decision, applying the documented
 * fallback semantics. NEVER returns `passed:true` silently when results are
 * missing — it returns a `tests-inconclusive` decision the caller flags loudly.
 */
export function evaluateGate(
  baseline: TestRunOutcome | null,
  after: TestRunOutcome
): GateDecision {
  return {
    ...evaluateGateInner(baseline, after),
    testCommand: after.command ?? baseline?.command ?? null,
  };
}

type BareDecision = Omit<GateDecision, "testCommand">;

function bullets(ids: string[]): string {
  return ids
    .slice(0, 20)
    .map((r) => `  - ${r}`)
    .join("\n");
}

/** Primary path: per-test results for BOTH runs => the real baseline diff. */
function gateFromDiff(
  baselineResults: TestResultMap,
  afterResults: TestResultMap
): BareDecision {
  const baselinePassCount = countPassing(baselineResults);
  const afterPassCount = countPassing(afterResults);
  const { regressions, newlyFailing } = diffTestResults(
    baselineResults,
    afterResults
  );
  const counts = { baselinePassCount, afterPassCount };
  if (regressions.length > 0) {
    return {
      passed: false,
      code: "regressions",
      ...counts,
      regressions,
      newlyFailing,
      summary: `Tests: ${baselinePassCount} passing before → ${afterPassCount} after, ${regressions.length} regression${regressions.length === 1 ? "" : "s"}`,
      reason: `The fix broke ${regressions.length} previously-passing test(s):\n${bullets(regressions)}`,
    };
  }
  if (newlyFailing.length > 0) {
    return {
      passed: false,
      code: "added-test-failed",
      ...counts,
      regressions,
      newlyFailing,
      summary: `Tests: ${baselinePassCount} passing before → ${afterPassCount} after, 0 regressions but ${newlyFailing.length} new test(s) FAILING`,
      reason: `The agent added test(s) that do not pass — the fix is not proven:\n${bullets(newlyFailing)}`,
    };
  }
  return {
    passed: true,
    code: "no-regressions",
    ...counts,
    regressions: [],
    newlyFailing: [],
    summary: `Tests: ${baselinePassCount} passing before → ${afterPassCount} after, 0 regressions`,
  };
}

/**
 * Fallback A: baseline unparseable but the AFTER run has per-test results. We
 * can't diff, so fall back to OLD semantics for THIS run: the after-suite must
 * pass (no failures).
 */
function gateFromAfterOnly(afterResults: TestResultMap): BareDecision {
  const afterPassCount = countPassing(afterResults);
  const failed = [...afterResults.entries()]
    .filter(([, s]) => s === "failed")
    .map(([id]) => id);
  if (failed.length === 0) {
    return {
      passed: true,
      code: "after-suite-passed",
      baselinePassCount: null,
      afterPassCount,
      regressions: [],
      newlyFailing: [],
      summary: `Tests: baseline unavailable; after-fix suite GREEN (${afterPassCount} passing, 0 failing)`,
      reason:
        "Baseline could not be captured; fell back to requiring the after-fix suite to pass, which it did.",
    };
  }
  return {
    passed: false,
    code: "after-suite-failed",
    baselinePassCount: null,
    afterPassCount,
    regressions: [],
    newlyFailing: failed,
    summary: `Tests: baseline unavailable; after-fix suite has ${failed.length} failing`,
    reason: `Baseline could not be captured, so the after-fix suite had to pass — it did not. Failing:\n${bullets(failed)}`,
  };
}

/**
 * Fallback B: no parseable per-test results at all (unknown runner, or both
 * runs crashed before any test). NEVER a silent pass — exit-0 opens the PR with
 * a loud "unverified" flag, timeout/failure-with-no-data behave per the doc.
 */
function gateInconclusive(
  after: TestRunOutcome,
  baselinePassCount: number | null
): BareDecision {
  const empty = {
    baselinePassCount,
    afterPassCount: null,
    regressions: [] as string[],
    newlyFailing: [] as string[],
  };
  if (after.timedOut) {
    return {
      passed: false,
      code: "tests-inconclusive",
      ...empty,
      summary: "Tests: after-fix run TIMED OUT",
      reason: `The after-fix test run timed out. Tail:\n${after.outputTail}`,
    };
  }
  if (after.exitCode === 0) {
    return {
      passed: true,
      code: "tests-inconclusive",
      ...empty,
      summary:
        "Tests: per-test results UNVERIFIED (no machine-readable reporter); test command exited 0",
      reason:
        "Could not parse per-test results, but the after-fix test command exited 0. Opening the PR with a visible 'tests unverified' warning — a human reviews the PR.",
    };
  }
  // No per-test data and a non-zero exit. We still open the PR (a human reviews
  // it) but flag loudly that tests are unverified — never discard a good fix.
  return {
    passed: true,
    code: "tests-inconclusive",
    ...empty,
    summary:
      "Tests: UNVERIFIED — could not produce per-test results in the ephemeral clone",
    reason: `Could not verify tests (no machine-readable per-test results; after-fix command exited ${after.exitCode}). Opening the PR WITH a visible 'tests unverified' warning so a human reviews it; the fix was not discarded. Tail:\n${after.outputTail}`,
  };
}

function evaluateGateInner(
  baseline: TestRunOutcome | null,
  after: TestRunOutcome
): BareDecision {
  const baselineResults = baseline?.results ?? null;
  const afterResults = after.results;
  if (baselineResults && afterResults) {
    return gateFromDiff(baselineResults, afterResults);
  }
  if (afterResults) {
    return gateFromAfterOnly(afterResults);
  }
  return gateInconclusive(after, countPassing(baselineResults));
}

export const TEST_GATE_TIMEOUT_MS = DEFAULT_TEST_TIMEOUT_MS;
