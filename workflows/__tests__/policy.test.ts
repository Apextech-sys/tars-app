import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolvePolicy, severityAtLeast } from "../lib/policy";

let tmpYamlPath: string;

beforeAll(() => {
  const yaml = `
polymarket-v2:
  kind: product
  visibility: work
  business: polymarket
  description: live trading platform
  repos:
    - Apextech-sys/polymarket-v2
  partners: []
  linear_team: PMK
  slack: '#polymarket'

konverge:
  kind: client
  visibility: work
  business: konverge
  description: konverge partner repo
  repos:
    - Konverge-IO/data-platform
    - Apextech-sys/konverge-tools
  partners:
    - konverge
  linear_team: ''
  slack: ''

freshbark:
  kind: product
  visibility: work
  business: freshbark
  description: petcare project
  repos:
    - APEXTECH-sys/freshbark-web
  partners: []
  linear_team: ''
  slack: '#freshbark'
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
  } catch {}
});

describe("resolvePolicy", () => {
  it("matches polymarket-v2 → autoReview=true, autoFix=false, slack channel", async () => {
    const p = await resolvePolicy("Apextech-sys", "polymarket-v2");
    expect(p.matched).toBe(true);
    expect(p.projectKey).toBe("polymarket-v2");
    expect(p.autoReview).toBe(true);
    expect(p.autoFix).toBe(false); // live trading — never autofix
    expect(p.protectMode).toBe(false);
    expect(p.slackChannel).toBe("#polymarket");
    expect(p.slackNotify).toBe(true);
  });

  it("matches konverge → protectMode=true, all writes disallowed", async () => {
    const p = await resolvePolicy("Konverge-IO", "data-platform");
    expect(p.matched).toBe(true);
    expect(p.protectMode).toBe(true);
    expect(p.autoFix).toBe(false);
    expect(p.issueTracker).toBe("none");
    expect(p.slackNotify).toBe(false);
  });

  it("matches konverge via Apextech-sys/konverge-tools (partner code propagates)", async () => {
    const p = await resolvePolicy("Apextech-sys", "konverge-tools");
    expect(p.matched).toBe(true);
    expect(p.protectMode).toBe(true);
  });

  it("case-insensitive owner/repo matching", async () => {
    const p = await resolvePolicy("apextech-sys", "freshbark-web");
    expect(p.matched).toBe(true);
    expect(p.projectKey).toBe("freshbark");
    expect(p.autoFix).toBe(true); // not polymarket-v2, not konverge
    expect(p.slackChannel).toBe("#freshbark");
  });

  it("unknown project falls back to default policy (review-only, no writes off, no protect)", async () => {
    const p = await resolvePolicy("some-random-org", "some-random-repo");
    expect(p.matched).toBe(false);
    expect(p.projectKey).toBeNull();
    expect(p.autoReview).toBe(true);
    expect(p.autoFix).toBe(false);
    expect(p.protectMode).toBe(false);
    expect(p.issueTracker).toBe("none");
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
