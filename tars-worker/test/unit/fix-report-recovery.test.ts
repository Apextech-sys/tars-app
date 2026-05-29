import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadReport,
  obtainFixReport,
  type ReportLoader,
  type TurnRunner,
} from "../../src/handlers/claude-fix-apply.js";
import type { HandlerContext } from "../../src/types.js";

/**
 * Recovery-path proof (PR #6 burn-in): when the FIRST fix turn finishes its
 * work but returns PROSE with no parseable JSON report, the handler must issue
 * exactly ONE recovery turn that RESUMES the same session and yields a parsed
 * report — instead of discarding the completed fix.
 *
 * These tests inject a fake TurnRunner so the loop is exercised end-to-end
 * without a live Claude session or any DB.
 */

const VALID_REPORT = {
  revalidation: [
    {
      file: "src/math.ts",
      line: 3,
      message: "off-by-one in sum()",
      kept: true,
      reason: "reproduced against the real file",
    },
  ],
  blastRadius: {
    summary: "single pure function, no external callers in radius",
    changedFiles: ["src/math.ts"],
    callers: [],
  },
  fixSummary: "corrected the loop bound in sum()",
  testsAdded: true,
  testExemptionReason: null,
  testFiles: ["src/math.test.ts"],
  coverageRootCause: "no test exercised the multi-element path",
  existingTestsPassed: true,
  testCommand: "pnpm test",
  testOutputTail: "2 passed",
};

const PROSE_NO_JSON =
  "All stages complete. Here's a summary: I re-validated the finding, " +
  "traced the blast radius, applied a minimal fix, and the existing suite " +
  "passes. I also added a regression test. Let me know if you need anything!";

function fakeCtx(): HandlerContext {
  const logs: Array<{ msg: string; fields?: Record<string, unknown> }> = [];
  const ctx = {
    job: { id: "test-job" } as HandlerContext["job"],
    signal: new AbortController().signal,
    updateSessionId: () => Promise.resolve(),
    log: (msg: string, fields?: Record<string, unknown>) => {
      logs.push({ msg, fields });
    },
  } as unknown as HandlerContext & {
    _logs: typeof logs;
  };
  // expose for assertions
  (ctx as unknown as { _logs: typeof logs })._logs = logs;
  return ctx;
}

describe("obtainFixReport — fix-report recovery turn", () => {
  it("issues a SECOND (resumed) turn when the first returns prose, then parses", async () => {
    const ctx = fakeCtx();
    const reportPath = "/tmp/does-not-matter.json";
    const calls: Array<{ resume?: string; prompt: string }> = [];

    // Turn 1: prose only, no file. Turn 2 (resume): raw JSON.
    const turnRunner: TurnRunner = (_c, _ws, prompt, resume) => {
      calls.push({ resume, prompt });
      if (calls.length === 1) {
        return Promise.resolve({
          sessionId: "sess-123",
          resultText: PROSE_NO_JSON,
        });
      }
      return Promise.resolve({
        sessionId: "sess-123",
        resultText: JSON.stringify(VALID_REPORT),
      });
    };
    // reportLoader: only the resultText matters here (no file on disk).
    const reportLoader: ReportLoader = (rp, text) => loadReport(rp, text);

    const result = await obtainFixReport(ctx, "/tmp/ws", reportPath, "PROMPT", {
      turnRunner,
      reportLoader,
    });

    // The second turn MUST have fired, resuming the same session.
    expect(calls).toHaveLength(2);
    expect(calls[0].resume).toBeUndefined();
    expect(calls[1].resume).toBe("sess-123");
    expect(calls[1].prompt).toContain("did NOT produce the required");

    // The report parsed from the recovery turn.
    expect(result.recoveryUsed).toBe(true);
    expect(result.report).not.toBeNull();
    expect(result.report?.fixSummary).toBe("corrected the loop bound in sum()");
    expect(result.sessionId).toBe("sess-123");

    // The recovery was logged so it shows up in the timeline.
    const logs = (ctx as unknown as { _logs: Array<{ msg: string }> })._logs;
    expect(logs.some((l) => l.msg.includes("fix-report-recovery"))).toBe(true);
  });

  it("recovers by re-reading the .tars-fix-report.json the agent wrote on the 2nd turn", async () => {
    const ctx = fakeCtx();
    const ws = await mkdtemp(join(tmpdir(), "tars-fix-recovery-test-"));
    const reportPath = join(ws, ".tars-fix-report.json");
    try {
      const turnRunner: TurnRunner = async (_c, _ws, _prompt, resume) => {
        if (!resume) {
          // first turn: prose, no file written
          return { sessionId: "sess-abc", resultText: PROSE_NO_JSON };
        }
        // recovery turn: agent (re)writes the file, returns terse prose
        await writeFile(reportPath, JSON.stringify(VALID_REPORT), "utf8");
        return { sessionId: "sess-abc", resultText: "done" };
      };

      const result = await obtainFixReport(ctx, ws, reportPath, "PROMPT", {
        turnRunner,
      });

      expect(result.recoveryUsed).toBe(true);
      expect(result.report?.fixSummary).toBe(
        "corrected the loop bound in sum()"
      );
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it("does NOT issue a recovery turn on the happy path", async () => {
    const ctx = fakeCtx();
    let turns = 0;
    const turnRunner: TurnRunner = () => {
      turns += 1;
      return Promise.resolve({
        sessionId: "sess-happy",
        resultText: JSON.stringify(VALID_REPORT),
      });
    };

    const result = await obtainFixReport(ctx, "/tmp/ws", "/tmp/r.json", "P", {
      turnRunner,
    });

    expect(turns).toBe(1);
    expect(result.recoveryUsed).toBe(false);
    expect(result.report).not.toBeNull();
  });

  it("fails (recovery noted) when BOTH turns yield no parseable report", async () => {
    const ctx = fakeCtx();
    const turnRunner: TurnRunner = () =>
      Promise.resolve({
        sessionId: "sess-x",
        resultText: PROSE_NO_JSON,
      });

    const result = await obtainFixReport(ctx, "/tmp/ws", "/tmp/r.json", "P", {
      turnRunner,
    });

    expect(result.recoveryUsed).toBe(true);
    expect(result.report).toBeNull();
  });

  it("surfaces a turn-1 hard error WITHOUT attempting recovery", async () => {
    const ctx = fakeCtx();
    let turns = 0;
    const turnRunner: TurnRunner = () => {
      turns += 1;
      return Promise.resolve({
        sessionId: "sess-err",
        resultText: "",
        error: "aborted (job timeout)",
      });
    };

    const result = await obtainFixReport(ctx, "/tmp/ws", "/tmp/r.json", "P", {
      turnRunner,
    });

    expect(turns).toBe(1);
    expect(result.recoveryUsed).toBe(false);
    expect(result.error).toBe("aborted (job timeout)");
    expect(result.report).toBeNull();
  });
});
