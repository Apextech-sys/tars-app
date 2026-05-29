import { describe, expect, it } from "vitest";
import {
  diffTestResults,
  evaluateGate,
  parseJestJson,
  type TestResultMap,
  type TestRunOutcome,
  type TestStatus,
} from "../../src/handlers/test-gate.js";

/**
 * Baseline-diff gate proof.
 *
 * The gate replaces the old "all tests must pass" semantics with: a fix is
 * SAFE iff it introduces no REGRESSION (a test that passed in the baseline and
 * now fails). Pre-existing reds and env-dependent tests that fail in BOTH runs
 * do NOT block. These deterministic tests over synthetic before/after sets are
 * the cleanest proof of both directions:
 *   - a fix that breaks a previously-passing test => gate FAILS (regression).
 *   - tests red in BOTH baseline and after => gate PASSES (0 regressions).
 */

function m(entries: [string, TestStatus][]): TestResultMap {
  return new Map(entries);
}

function outcome(
  results: TestResultMap | null,
  over: Partial<TestRunOutcome> = {}
): TestRunOutcome {
  return {
    command: "pnpm exec vitest run",
    results,
    exitCode: results ? 0 : null,
    timedOut: false,
    outputTail: "",
    ...over,
  };
}

describe("diffTestResults (pure core)", () => {
  it("flags a test that was PASSING and is now FAILING as a regression", () => {
    const before = m([
      ["a", "passed"],
      ["b", "passed"],
    ]);
    const after = m([
      ["a", "passed"],
      ["b", "failed"], // broke b
    ]);
    const { regressions, newlyFailing } = diffTestResults(before, after);
    expect(regressions).toEqual(["b"]);
    expect(newlyFailing).toEqual([]);
  });

  it("does NOT flag a test that was failing in BOTH runs (pre-existing red)", () => {
    const before = m([
      ["a", "passed"],
      ["db-role", "failed"], // env-flaky, fails both
    ]);
    const after = m([
      ["a", "passed"],
      ["db-role", "failed"],
    ]);
    const { regressions, newlyFailing } = diffTestResults(before, after);
    expect(regressions).toEqual([]);
    expect(newlyFailing).toEqual([]);
  });

  it("flags a newly-ADDED failing test as newlyFailing, not a regression", () => {
    const before = m([["a", "passed"]]);
    const after = m([
      ["a", "passed"],
      ["new-regression-test", "failed"], // agent's own test fails
    ]);
    const { regressions, newlyFailing } = diffTestResults(before, after);
    expect(regressions).toEqual([]);
    expect(newlyFailing).toEqual(["new-regression-test"]);
  });

  it("a newly-added PASSING test is fine (not flagged)", () => {
    const before = m([["a", "passed"]]);
    const after = m([
      ["a", "passed"],
      ["new-regression-test", "passed"],
    ]);
    const { regressions, newlyFailing } = diffTestResults(before, after);
    expect(regressions).toEqual([]);
    expect(newlyFailing).toEqual([]);
  });
});

describe("evaluateGate — REGRESSION IS CAUGHT", () => {
  it("FAILS the gate when the fix breaks a previously-passing test", () => {
    const baseline = outcome(
      m([
        ["a", "passed"],
        ["b", "passed"],
      ])
    );
    const after = outcome(
      m([
        ["a", "passed"],
        ["b", "failed"],
      ])
    );
    const decision = evaluateGate(baseline, after);
    expect(decision.passed).toBe(false);
    expect(decision.code).toBe("regressions");
    expect(decision.regressions).toEqual(["b"]);
    expect(decision.summary).toContain("1 regression");
    expect(decision.baselinePassCount).toBe(2);
    expect(decision.afterPassCount).toBe(1);
  });

  it("FAILS the gate when the agent's own added test fails", () => {
    const baseline = outcome(m([["a", "passed"]]));
    const after = outcome(
      m([
        ["a", "passed"],
        ["added", "failed"],
      ])
    );
    const decision = evaluateGate(baseline, after);
    expect(decision.passed).toBe(false);
    expect(decision.code).toBe("added-test-failed");
    expect(decision.newlyFailing).toEqual(["added"]);
  });
});

describe("evaluateGate — PRE-EXISTING REDS DO NOT BLOCK", () => {
  it("PASSES when the same tests are red in BOTH baseline and after", () => {
    // Mirrors the real PR #10/#11 scenario: DB tests fail in the clone (no
    // DATABASE_URL) in BOTH runs, so they are not regressions.
    const baseline = outcome(
      m([
        ["unit-1", "passed"],
        ["unit-2", "passed"],
        ["db-test-1", "failed"], // role "shaun" does not exist
        ["db-test-2", "failed"],
      ])
    );
    const after = outcome(
      m([
        ["unit-1", "passed"],
        ["unit-2", "passed"],
        ["db-test-1", "failed"],
        ["db-test-2", "failed"],
      ])
    );
    const decision = evaluateGate(baseline, after);
    expect(decision.passed).toBe(true);
    expect(decision.code).toBe("no-regressions");
    expect(decision.regressions).toEqual([]);
    expect(decision.summary).toContain("0 regressions");
  });

  it("PASSES and counts a newly-fixed test (red->green) as no regression", () => {
    const baseline = outcome(
      m([
        ["a", "passed"],
        ["target-bug", "failed"], // the bug being fixed
        ["db-test", "failed"], // env-flaky
      ])
    );
    const after = outcome(
      m([
        ["a", "passed"],
        ["target-bug", "passed"], // fix turned it green
        ["db-test", "failed"], // still env-flaky, both runs
      ])
    );
    const decision = evaluateGate(baseline, after);
    expect(decision.passed).toBe(true);
    expect(decision.code).toBe("no-regressions");
    expect(decision.baselinePassCount).toBe(1);
    expect(decision.afterPassCount).toBe(2);
  });
});

describe("evaluateGate — fallbacks (never silent success)", () => {
  it("falls back to after-suite-must-pass when the baseline is unparseable", () => {
    const after = outcome(
      m([
        ["a", "passed"],
        ["b", "passed"],
      ])
    );
    const decision = evaluateGate(outcome(null), after);
    expect(decision.passed).toBe(true);
    expect(decision.code).toBe("after-suite-passed");
  });

  it("FAILS the fallback when baseline missing AND the after-suite has failures", () => {
    const after = outcome(
      m([
        ["a", "passed"],
        ["b", "failed"],
      ])
    );
    const decision = evaluateGate(outcome(null), after);
    expect(decision.passed).toBe(false);
    expect(decision.code).toBe("after-suite-failed");
  });

  it("marks inconclusive (but still opens) when no per-test data and exit 0", () => {
    const after = outcome(null, { exitCode: 0 });
    const decision = evaluateGate(null, after);
    expect(decision.passed).toBe(true);
    expect(decision.code).toBe("tests-inconclusive");
    expect(decision.summary.toLowerCase()).toContain("unverified");
  });

  it("FAILS when the after-run timed out", () => {
    const after = outcome(null, { exitCode: null, timedOut: true });
    const decision = evaluateGate(null, after);
    expect(decision.passed).toBe(false);
    expect(decision.summary).toContain("TIMED OUT");
  });

  it("opens-with-warning (inconclusive) on non-zero exit with no per-test data", () => {
    const after = outcome(null, { exitCode: 1 });
    const decision = evaluateGate(null, after);
    expect(decision.code).toBe("tests-inconclusive");
    // Opens for human review rather than discarding the fix.
    expect(decision.passed).toBe(true);
  });
});

describe("parseJestJson", () => {
  it("parses the Jest-compatible vitest JSON reporter shape", () => {
    const raw = JSON.stringify({
      testResults: [
        {
          name: "/repo/src/math.test.ts",
          assertionResults: [
            { fullName: "sum adds", status: "passed" },
            { fullName: "sum handles empty", status: "failed" },
            { fullName: "sum skipped", status: "skipped" },
          ],
        },
      ],
    });
    const map = parseJestJson(raw);
    expect(map).not.toBeNull();
    const entries = [...(map as TestResultMap).entries()];
    expect(entries).toHaveLength(3);
    const statuses = Object.fromEntries(
      entries.map(([k, v]) => [k.split(" :: ")[1], v])
    );
    expect(statuses["sum adds"]).toBe("passed");
    expect(statuses["sum handles empty"]).toBe("failed");
    expect(statuses["sum skipped"]).toBe("skipped");
  });

  it("returns null for non-JSON / empty output", () => {
    expect(parseJestJson("not json at all")).toBeNull();
    expect(parseJestJson("")).toBeNull();
    expect(parseJestJson(JSON.stringify({ testResults: [] }))).toBeNull();
  });

  it("namespaces identically-named tests in different files", () => {
    const raw = JSON.stringify({
      testResults: [
        {
          name: "a.test.ts",
          assertionResults: [{ fullName: "x", status: "passed" }],
        },
        {
          name: "b.test.ts",
          assertionResults: [{ fullName: "x", status: "failed" }],
        },
      ],
    });
    const map = parseJestJson(raw) as TestResultMap;
    expect(map.size).toBe(2);
  });
});
