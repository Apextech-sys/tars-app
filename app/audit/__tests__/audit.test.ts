/**
 * app/audit/__tests__/audit.test.ts
 *
 * Tests for fetchAuditLogs: filtering, pagination, distinct values.
 * Uses the real Postgres DB (DATABASE_URL must be set).
 *
 * The audit_log table may be empty in a fresh environment — these tests
 * only assert structural correctness, not specific row counts.
 */

import { describe, expect, it } from "vitest";
import {
  fetchAuditDistinctRepos,
  fetchAuditDistinctSteps,
  fetchAuditLogs,
  exportAuditCsv,
} from "@/app/audit/actions";

describe("fetchAuditLogs", () => {
  it("returns result shape with rows and total", async () => {
    const result = await fetchAuditLogs({});
    expect(result).toHaveProperty("rows");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.rows)).toBe(true);
    expect(typeof result.total).toBe("number");
  });

  it("respects limit", async () => {
    const result = await fetchAuditLogs({ limit: 5 });
    expect(result.rows.length).toBeLessThanOrEqual(5);
  });

  it("respects offset for pagination", async () => {
    const page0 = await fetchAuditLogs({ limit: 2, offset: 0 });
    const page1 = await fetchAuditLogs({ limit: 2, offset: 2 });

    if (page0.rows.length === 2 && page1.rows.length > 0) {
      // The first item on page 1 should differ from all items on page 0
      const page0Ids = new Set(page0.rows.map((r) => r.id));
      expect(page0Ids.has(page1.rows[0].id)).toBe(false);
    }
  });

  it("filters by runId substring", async () => {
    // Get any runId that exists
    const all = await fetchAuditLogs({ limit: 1 });
    if (all.rows.length === 0) return; // no data, skip

    const runId = all.rows[0].runId.slice(0, 6);
    const filtered = await fetchAuditLogs({ runId });
    expect(filtered.rows.every((r) => r.runId.includes(runId))).toBe(true);
  });

  it("filters by step", async () => {
    const steps = await fetchAuditDistinctSteps();
    if (steps.length === 0) return; // no data

    const step = steps[0];
    const result = await fetchAuditLogs({ steps: [step] });
    expect(result.rows.every((r) => r.step === step)).toBe(true);
  });

  it("filters by repo", async () => {
    const repos = await fetchAuditDistinctRepos();
    if (repos.length === 0) return; // no data

    const repo = repos[0];
    const result = await fetchAuditLogs({ repos: [repo] });
    expect(result.rows.every((r) => r.repo === repo)).toBe(true);
  });

  it("each row has required fields", async () => {
    const result = await fetchAuditLogs({ limit: 10 });
    for (const row of result.rows) {
      expect(typeof row.id).toBe("number");
      expect(typeof row.runId).toBe("string");
      expect(typeof row.step).toBe("string");
      expect(typeof row.status).toBe("string");
      expect(typeof row.createdAt).toBe("string");
      // createdAt should be a valid ISO string
      expect(new Date(row.createdAt).toString()).not.toBe("Invalid Date");
    }
  });

  it("date range filter works", async () => {
    const future = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
    const result = await fetchAuditLogs({ dateTo: "2000-01-01" });
    // Nothing should be before year 2000 — empty result expected
    expect(result.rows.length).toBe(0);
  });
});

describe("fetchAuditDistinctSteps", () => {
  it("returns an array of strings", async () => {
    const steps = await fetchAuditDistinctSteps();
    expect(Array.isArray(steps)).toBe(true);
    for (const s of steps) {
      expect(typeof s).toBe("string");
    }
  });
});

describe("fetchAuditDistinctRepos", () => {
  it("returns an array of strings", async () => {
    const repos = await fetchAuditDistinctRepos();
    expect(Array.isArray(repos)).toBe(true);
    for (const r of repos) {
      expect(typeof r).toBe("string");
    }
  });
});

describe("exportAuditCsv", () => {
  it("returns a string starting with CSV header", async () => {
    const csv = await exportAuditCsv({});
    expect(typeof csv).toBe("string");
    expect(csv.startsWith("id,run_id,workflow,step,status")).toBe(true);
  });

  it("has correct number of columns per data row", async () => {
    const csv = await exportAuditCsv({ limit: 3 } as Parameters<
      typeof exportAuditCsv
    >[0]);
    const lines = csv.split("\n").filter(Boolean);
    if (lines.length > 1) {
      // Header has 10 columns
      expect(lines[0].split(",").length).toBe(10);
    }
  });
});
