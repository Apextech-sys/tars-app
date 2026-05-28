import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolvePolicy, severityAtLeast } from "../lib/policy";

let tmpYamlPath: string;

beforeAll(() => {
  // Slice 1: protect_mode is retired. issue_tracker / linear_team / auto_fix /
  // severity_threshold are now read straight from projects.yaml. The fixture
  // below mirrors the real konverge entry (issue_tracker: linear, team: REF)
  // so the resolver is tested against config-driven semantics.
  const yaml = `
polymarket-v2:
  kind: product
  visibility: work
  business: polymarket
  description: live trading platform
  repos:
    - Apextech-sys/polymarket-v2
  auto_review: true
  auto_fix: false
  severity_threshold: major
  issue_tracker: github_issues
  slack: '#polymarket'

konverge:
  kind: client
  visibility: work
  business: Apextech
  description: konverge partner repo
  repos:
    - Apextech-Dev/reflex-connect-aws
    - Apextech-Dev/reflex-connect-v2
  auto_review: true
  auto_fix: false
  severity_threshold: minor
  issue_tracker: linear
  linear_team: REF
  slack: '#p45'

freshbark:
  kind: product
  visibility: work
  business: freshbark
  description: petcare project
  repos:
    - APEXTECH-sys/freshbark-web
  auto_review: true
  auto_fix: true
  issue_tracker: github_issues
  slack: '#freshbark'

disabled-repo:
  kind: product
  visibility: work
  business: misc
  repos:
    - Apextech-sys/disabled-thing
  auto_review: false
  auto_fix: false
`.trim();

  tmpYamlPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "tars-policy-")),
    "projects.yaml"
  );
  fs.writeFileSync(tmpYamlPath, yaml, "utf8");
  process.env.TARS_PROJECTS_YAML_PATH = tmpYamlPath;
});

afterAll(() => {
  try {
    fs.unlinkSync(tmpYamlPath);
  } catch {
    // best-effort cleanup of test fixture; ignore missing-file / EBUSY
  }
});

describe("resolvePolicy", () => {
  it("matches polymarket-v2 → autoReview=true, autoFix=false, github tracker", async () => {
    const p = await resolvePolicy("Apextech-sys", "polymarket-v2");
    expect(p.matched).toBe(true);
    expect(p.projectKey).toBe("polymarket-v2");
    expect(p.autoReview).toBe(true);
    expect(p.autoFix).toBe(false); // live trading — never autofix
    expect(p.severityThreshold).toBe("major");
    expect(p.issueTracker).toBe("github");
    expect(p.linearTeam).toBeNull();
    expect(p.slackChannel).toBe("#polymarket");
    expect(p.slackNotify).toBe(true);
  });

  it("matches konverge → review runs, issueTracker=linear, linearTeam=REF (no protect_mode)", async () => {
    const p = await resolvePolicy("Apextech-Dev", "reflex-connect-aws");
    expect(p.matched).toBe(true);
    expect(p.projectKey).toBe("konverge");
    expect(p.autoReview).toBe(true); // review now runs on konverge repos
    expect(p.autoFix).toBe(false);
    expect(p.issueTracker).toBe("linear");
    expect(p.linearTeam).toBe("REF");
    // protect_mode is retired — there is no protectMode field on the policy.
    expect("protectMode" in p).toBe(false);
  });

  it("matches konverge v2 repo too", async () => {
    const p = await resolvePolicy("Apextech-Dev", "reflex-connect-v2");
    expect(p.matched).toBe(true);
    expect(p.projectKey).toBe("konverge");
    expect(p.issueTracker).toBe("linear");
    expect(p.linearTeam).toBe("REF");
  });

  it("case-insensitive owner/repo matching", async () => {
    const p = await resolvePolicy("apextech-sys", "freshbark-web");
    expect(p.matched).toBe(true);
    expect(p.projectKey).toBe("freshbark");
    expect(p.autoFix).toBe(true);
    expect(p.issueTracker).toBe("github");
    expect(p.slackChannel).toBe("#freshbark");
  });

  it("honors auto_review:false (skipped by policy, unrelated to protect_mode)", async () => {
    const p = await resolvePolicy("Apextech-sys", "disabled-thing");
    expect(p.matched).toBe(true);
    expect(p.autoReview).toBe(false);
  });

  it("unknown project falls back to default policy (review-only, no autofix)", async () => {
    const p = await resolvePolicy("some-random-org", "some-random-repo");
    expect(p.matched).toBe(false);
    expect(p.projectKey).toBeNull();
    expect(p.autoReview).toBe(true);
    expect(p.autoFix).toBe(false);
    expect(p.issueTracker).toBe("none");
    expect(p.linearTeam).toBeNull();
    expect(p.slackNotify).toBe(false);
  });
});

describe("severityAtLeast", () => {
  it("critical >= major >= minor >= nit", () => {
    expect(severityAtLeast("critical", "minor")).toBe(true);
    expect(severityAtLeast("major", "minor")).toBe(true);
    expect(severityAtLeast("minor", "minor")).toBe(true);
    expect(severityAtLeast("nit", "minor")).toBe(false);
    expect(severityAtLeast("minor", "major")).toBe(false);
    expect(severityAtLeast("critical", "critical")).toBe(true);
  });
});
