/**
 * Graph + projects.yaml + audit snapshot builder for the brief workflow.
 *
 * Every exported function is "use step" so the WDK runs them as durable
 * Node steps. We talk to:
 *   - the Kuzu graph at /home/shaun/.tars-state/graph.kuzu via a Python
 *     subprocess that activates the graphiti venv. This is the same
 *     approach the existing briefing.py uses, just inverted: we pull
 *     structured JSON out instead of rendering text.
 *   - /home/shaun/.tars-state/knowledge/projects.yaml directly.
 *   - the audit_log table directly via postgres.
 *
 * Failure mode: every call is wrapped in try/catch and degrades to an
 * empty snapshot, with the error surfaced via the audit log. The brief
 * is allowed to compose with a partial picture; silently giving up is
 * NOT acceptable.
 */

export interface GraphSnapshot {
  node_counts: Record<string, number>;
  edge_counts: Record<string, number>;
  project_count: number;
  protected_projects: Array<{ key: string; reason?: string }>;
  available: boolean;
  error?: string;
}

export interface ProjectsYamlSummary {
  total: number;
  by_visibility: Record<string, number>;
  gaps: Array<{ project: string; missing_fields: string[] }>;
  available: boolean;
  error?: string;
}

export interface AuditWindowSummary {
  total_entries: number;
  by_outcome: Record<string, number>;
  by_workflow: Record<string, number>;
  available: boolean;
  error?: string;
}

const GRAPH_DIR =
  process.env.TARS_GRAPH_DIR ?? "/home/shaun/.tars-state/tars_graph";
const GRAPH_PY =
  process.env.TARS_GRAPH_PY ??
  "/home/shaun/.tars-state/graphiti-venv/bin/python";
const PROJECTS_YAML =
  process.env.TARS_PROJECTS_YAML_PATH ??
  "/home/shaun/.tars-state/knowledge/projects.yaml";

/**
 * Build the graph snapshot by shelling out to a one-shot Python script that
 * imports TarsGraph and returns JSON on stdout. We cannot query Kuzu from
 * Node directly without a custom binding, but the discovery workers already
 * speak Python, so we reuse their venv.
 */
export async function buildGraphSnapshot(): Promise<GraphSnapshot> {
  "use step";
  const { spawn } = await import("node:child_process");
  const fs = await import("node:fs/promises");

  // Check the helpers exist before we shell out. If the graph is missing,
  // return a clean empty snapshot rather than blowing up the workflow.
  try {
    await fs.access(GRAPH_PY);
    await fs.access(`${GRAPH_DIR}/__init__.py`);
  } catch (err) {
    return {
      node_counts: {},
      edge_counts: {},
      project_count: 0,
      protected_projects: [],
      available: false,
      error: `graph helpers missing: ${(err as Error).message}`,
    };
  }

  // Python script built as a string of lines to keep this file readable
  // and avoid quote-escaping problems. Indentation matters for Python.
  const py = [
    "import sys, json, asyncio",
    "sys.path.insert(0, \"/home/shaun/.tars-state\")",
    "from tars_graph import TarsGraph",
    "",
    "GID = \"discovered\"",
    "",
    "async def main():",
    "    out = {",
    "        \"node_counts\": {},",
    "        \"edge_counts\": {},",
    "        \"project_count\": 0,",
    "        \"protected_projects\": [],",
    "    }",
    "    try:",
    "        async with TarsGraph() as g:",
    "            rows, _, _ = await g.driver.execute_query(",
    "                \"MATCH (n:Entity) WHERE n.group_id = $gid RETURN n.labels AS labels, count(n) AS c\",",
    "                gid=GID,",
    "            )",
    "            for r in rows:",
    "                lbls = [l for l in r[\"labels\"] if l != \"Entity\"]",
    "                kind = lbls[0] if lbls else \"Entity\"",
    "                out[\"node_counts\"][kind] = out[\"node_counts\"].get(kind, 0) + r[\"c\"]",
    "",
    "            rows, _, _ = await g.driver.execute_query(",
    "                \"MATCH (e:RelatesToNode_) WHERE e.group_id = $gid RETURN e.name AS name, count(e) AS c\",",
    "                gid=GID,",
    "            )",
    "            for r in rows:",
    "                out[\"edge_counts\"][r[\"name\"]] = r[\"c\"]",
    "",
    "            rows, _, _ = await g.driver.execute_query(",
    "                \"MATCH (p:Entity) WHERE 'Project' IN p.labels AND p.group_id = $gid RETURN count(p) AS c\",",
    "                gid=GID,",
    "            )",
    "            out[\"project_count\"] = rows[0][\"c\"] if rows else 0",
    "",
    "            try:",
    "                rows, _, _ = await g.driver.execute_query(",
    "                    \"MATCH (p:Entity) WHERE 'Project' IN p.labels AND p.group_id = $gid AND p.protect_mode = true RETURN p.name AS name, p.description AS description\",",
    "                    gid=GID,",
    "                )",
    "                for r in rows:",
    "                    out[\"protected_projects\"].append({",
    "                        \"key\": r[\"name\"],",
    "                        \"reason\": (r.get(\"description\") or \"\")[:240],",
    "                    })",
    "            except Exception:",
    "                pass",
    "    except Exception as e:",
    "        print(json.dumps({\"__error__\": str(e)}), flush=True)",
    "        return",
    "    print(json.dumps(out), flush=True)",
    "",
    "asyncio.run(main())",
  ].join("\n");

  return await new Promise<GraphSnapshot>((resolve) => {
    const child = spawn(GRAPH_PY, ["-c", py], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PYTHONPATH: "/home/shaun/.tars-state" },
      cwd: GRAPH_DIR,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    const t = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, 30_000);
    child.on("close", (code) => {
      clearTimeout(t);
      if (code !== 0) {
        resolve({
          node_counts: {},
          edge_counts: {},
          project_count: 0,
          protected_projects: [],
          available: false,
          error: `python exited ${code}: ${stderr.slice(0, 400)}`,
        });
        return;
      }
      try {
        const trimmed = stdout.trim();
        const line = trimmed.split("\n").pop() ?? "{}";
        const parsed = JSON.parse(line);
        if (parsed.__error__) {
          resolve({
            node_counts: {},
            edge_counts: {},
            project_count: 0,
            protected_projects: [],
            available: false,
            error: parsed.__error__,
          });
          return;
        }
        resolve({
          node_counts: parsed.node_counts ?? {},
          edge_counts: parsed.edge_counts ?? {},
          project_count: parsed.project_count ?? 0,
          protected_projects: parsed.protected_projects ?? [],
          available: true,
        });
      } catch (err) {
        resolve({
          node_counts: {},
          edge_counts: {},
          project_count: 0,
          protected_projects: [],
          available: false,
          error: `parse failed: ${(err as Error).message}`,
        });
      }
    });
  });
}

/**
 * Parse /home/shaun/.tars-state/knowledge/projects.yaml and emit a structural
 * summary. We do not need every field — just enough for the model to spot
 * gaps and the unprotected/personal/work splits.
 */
export async function buildProjectsYamlSummary(): Promise<ProjectsYamlSummary> {
  "use step";
  const fs = await import("node:fs/promises");
  const yaml = await import("yaml");

  let text: string;
  try {
    text = await fs.readFile(PROJECTS_YAML, "utf8");
  } catch (err) {
    return {
      total: 0,
      by_visibility: {},
      gaps: [],
      available: false,
      error: `read projects.yaml failed: ${(err as Error).message}`,
    };
  }

  let parsed: Record<string, Record<string, unknown>>;
  try {
    parsed = (yaml.parse(text) ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
  } catch (err) {
    return {
      total: 0,
      by_visibility: {},
      gaps: [],
      available: false,
      error: `parse projects.yaml failed: ${(err as Error).message}`,
    };
  }

  const byVisibility: Record<string, number> = {};
  const gaps: Array<{ project: string; missing_fields: string[] }> = [];
  // Fields we expect a healthy project to have populated.
  const expected = [
    "linear_team",
    "slack",
    "vercel_project",
    "supabase_project",
    "aws_account",
  ];

  let total = 0;
  for (const [key, proj] of Object.entries(parsed)) {
    if (typeof proj !== "object" || proj === null) continue;
    if ((proj as Record<string, unknown>).kind === "skip") continue;
    total++;
    const visibility = String(
      (proj as Record<string, unknown>).visibility ?? "unknown",
    );
    byVisibility[visibility] = (byVisibility[visibility] ?? 0) + 1;

    const missing: string[] = [];
    for (const f of expected) {
      const v = (proj as Record<string, unknown>)[f];
      if (v === undefined || v === null || v === "") {
        missing.push(f);
      }
    }
    if (missing.length > 0) {
      gaps.push({ project: key, missing_fields: missing });
    }
  }

  // Cap gaps so the prompt does not blow up.
  return {
    total,
    by_visibility: byVisibility,
    gaps: gaps.slice(0, 30),
    available: true,
  };
}

/**
 * Roll the audit log into a structural summary for the given window.
 * Window is INCLUSIVE on the lower bound, EXCLUSIVE on the upper bound.
 */
export async function buildAuditWindow(args: {
  windowStart: string;
  windowEnd: string;
}): Promise<AuditWindowSummary> {
  "use step";
  const postgres = (await import("postgres")).default;
  const url =
    process.env.WORKFLOW_POSTGRES_URL ??
    process.env.DATABASE_URL ??
    "postgres://tars_app:5bb16db4a6db588a087139b7225537595c0140791c0a037a@127.0.0.1:5433/tars_app";
  const sql = postgres(url, { max: 2, idle_timeout: 20, prepare: false });
  try {
    const totals = await sql/* sql */`
      select status, workflow, count(*)::int as c
      from audit_log
      where created_at >= ${args.windowStart}::timestamptz
        and created_at <  ${args.windowEnd}::timestamptz
      group by status, workflow
    `;
    const byOutcome: Record<string, number> = {};
    const byWorkflow: Record<string, number> = {};
    let total = 0;
    for (const row of totals as unknown as Array<{
      status: string;
      workflow: string;
      c: number;
    }>) {
      byOutcome[row.status] = (byOutcome[row.status] ?? 0) + row.c;
      byWorkflow[row.workflow] = (byWorkflow[row.workflow] ?? 0) + row.c;
      total += row.c;
    }
    return {
      total_entries: total,
      by_outcome: byOutcome,
      by_workflow: byWorkflow,
      available: true,
    };
  } catch (err) {
    return {
      total_entries: 0,
      by_outcome: {},
      by_workflow: {},
      available: false,
      error: (err as Error).message,
    };
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}
