/**
 * app/settings/__tests__/policy.test.ts
 *
 * Tests for YAML policy load/save actions.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Must be hoisted before any action module import
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import {
  invalidateCache,
  loadProjectsYaml,
  saveKillSwitches,
  saveProjectsYaml,
} from "@/app/settings/actions";

const TMP_DIR = join(tmpdir(), `tars-policy-test-${process.pid}`);
const TMP_YAML = join(TMP_DIR, "projects.yaml");

beforeEach(async () => {
  mkdirSync(TMP_DIR, { recursive: true });
  process.env.TARS_PROJECTS_YAML_PATH = TMP_YAML;
  // Clear the mtime cache so each test starts fresh
  await invalidateCache();
});

afterEach(async () => {
  rmSync(TMP_DIR, { recursive: true, force: true });
  await invalidateCache();
});

describe("loadProjectsYaml", () => {
  it("returns empty object when file does not exist", async () => {
    // File doesn't exist
    const { parsed } = await loadProjectsYaml();
    expect(typeof parsed).toBe("object");
    expect(Array.isArray(parsed)).toBe(false);
  });

  it("parses existing YAML correctly", async () => {
    writeFileSync(
      TMP_YAML,
      "my-project:\n  kind: product\n  auto_review: true\n  auto_fix: false\n",
      "utf8",
    );
    const { parsed } = await loadProjectsYaml();
    expect(parsed["my-project"]).toBeDefined();
    expect(parsed["my-project"].kind).toBe("product");
    expect(parsed["my-project"].auto_review).toBe(true);
  });
});

describe("saveProjectsYaml", () => {
  it("writes valid YAML to disk and returns ok=true", async () => {
    writeFileSync(TMP_YAML, "# empty\n", "utf8");
    await invalidateCache();

    const result = await saveProjectsYaml(
      "test-project:\n  kind: sandbox\n  auto_review: true\n",
    );
    expect(result.ok).toBe(true);

    const { parsed } = await loadProjectsYaml();
    expect(parsed["test-project"]).toBeDefined();
    expect(parsed["test-project"].auto_review).toBe(true);
  });

  it("returns ok=false for invalid YAML", async () => {
    writeFileSync(TMP_YAML, "# empty\n", "utf8");

    const result = await saveProjectsYaml("{ bad yaml: [unclosed");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/yaml/i);
    }
  });

  it("returns ok=false if YAML root is not a mapping", async () => {
    writeFileSync(TMP_YAML, "# empty\n", "utf8");

    const result = await saveProjectsYaml("- item1\n- item2\n");
    expect(result.ok).toBe(false);
  });

  it("enforces konverge protect_mode cannot be set to false", async () => {
    writeFileSync(
      TMP_YAML,
      "konverge:\n  kind: client\n  protect_mode: true\n",
      "utf8",
    );

    const result = await saveProjectsYaml(
      "konverge:\n  kind: client\n  protect_mode: false\n",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/protect_mode/i);
    }
  });

  it("allows konverge with protect_mode omitted (stays true)", async () => {
    writeFileSync(TMP_YAML, "konverge:\n  kind: client\n", "utf8");
    await invalidateCache();

    const result = await saveProjectsYaml(
      "konverge:\n  kind: client\n  auto_review: true\n",
    );
    expect(result.ok).toBe(true);

    const { parsed } = await loadProjectsYaml();
    expect(parsed["konverge"].protect_mode).toBe(true);
  });
});

describe("saveKillSwitches", () => {
  it("updates auto_review and auto_fix for specified projects", async () => {
    writeFileSync(
      TMP_YAML,
      "proj-a:\n  auto_review: false\n  auto_fix: false\nproj-b:\n  auto_review: true\n",
      "utf8",
    );
    await invalidateCache();

    const result = await saveKillSwitches({
      "proj-a": { auto_review: true, auto_fix: true },
    });
    expect(result.ok).toBe(true);

    const { parsed } = await loadProjectsYaml();
    expect(parsed["proj-a"].auto_review).toBe(true);
    expect(parsed["proj-a"].auto_fix).toBe(true);
    expect(parsed["proj-b"].auto_review).toBe(true);
  });
});
