/**
 * TARS twice-daily briefing workflow (M5).
 *
 * Pipeline:
 *   1. context-graph         — Kuzu graph snapshot (Python subprocess)
 *   2. context-projects      — projects.yaml structural summary
 *   3. context-audit         — audit_log roll-up over the brief window
 *   4. context-github        — open PRs, recent issues, commit activity
 *   5. persist-pending       — insert briefs row in status=pending
 *   6. dispatch-compose      — dispatch claude-brief-compose job to worker
 *   7. wait-compose          — poll tars_jobs for the result
 *   8. finalize              — persist body_markdown + structured insights,
 *                              mirror to disk, mark status=ready
 *
 * Worker dispatch uses the same UUID-job + polling pattern as M4 PR review
 * (workflows/lib/worker-dispatch.ts). We deliberately do NOT use
 * waitForEvent / sendEvent — the M3 webhook silently swallows them.
 *
 * Konverge protect mode is not relevant here: the brief is read-only and
 * never posts anywhere. Personal-context-only — see project-vm103 notes.
 */

import { sleep } from "workflow";
import {
  type BriefKind,
  BriefOutputSchema,
  renderBriefMarkdown,
} from "../lib/tars/brief/schema";
import {
  finalizeBrief,
  insertPendingBrief,
  mirrorBriefToDisk,
  updateBriefStatus,
} from "./brief-lib/brief-store";
import {
  buildAuditWindow,
  buildGraphSnapshot,
  buildProjectsYamlSummary,
} from "./brief-lib/graph-context";
import {
  fetchCommitActivity,
  fetchOpenPRs,
  fetchRecentIssues,
} from "./brief-lib/repo-activity";
import { writeAudit } from "./lib/audit";
import { dispatchJob, pollJobOnce } from "./lib/worker-dispatch";

export interface BriefWorkflowInput {
  kind: BriefKind;
  /** Optional override; otherwise computed from `now()` UTC. */
  date?: string;
  /**
   * Workflow window override (ISO timestamps). When omitted we look back
   * 12 hours for a regular brief, 1 hour for an adhoc brief.
   */
  windowStart?: string;
  windowEnd?: string;
  /** Skip handing off to the worker (used by tests + dry-runs). */
  dryRun?: boolean;
}

export interface BriefWorkflowResult {
  runId: string;
  briefId?: string;
  status: "ready" | "failed";
  jobId?: string;
  diskPath?: string;
  error?: string;
}

const WORKER_TIMEOUT_MS = 10 * 60_000;

function todayUtcISO(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function computeWindow(
  kind: BriefKind,
  now = new Date()
): { windowStart: string; windowEnd: string } {
  const end = now;
  const lookbackHours = kind === "adhoc" ? 1 : 12;
  const start = new Date(end.getTime() - lookbackHours * 60 * 60_000);
  return {
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
  };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: WDK "use workflow" durable orchestration — the complexity is breadth (many sequentially-audited context/dispatch steps), not nesting. Extracting steps into helpers would cross WDK step/workflow boundaries and risk replay determinism, which the brief is explicit must not change.
export async function briefWorkflow(
  input: BriefWorkflowInput
): Promise<BriefWorkflowResult> {
  "use workflow";

  const now = new Date();
  const date = input.date ?? todayUtcISO(now);
  const { windowStart, windowEnd } = (() => {
    if (input.windowStart && input.windowEnd) {
      return { windowStart: input.windowStart, windowEnd: input.windowEnd };
    }
    return computeWindow(input.kind, now);
  })();

  const runId = `brief_${input.kind}_${date}_${now.getTime()}`;

  const audit = async (
    step: string,
    status: "start" | "ok" | "skip" | "error" | "info",
    data: Record<string, unknown> = {},
    message?: string
  ) => {
    await writeAudit({
      runId,
      workflow: "brief",
      step,
      status,
      message,
      data: { kind: input.kind, date, ...data },
    });
  };

  await audit("start", "start", {
    windowStart,
    windowEnd,
    dryRun: input.dryRun ?? false,
  });

  // ---------- Step 1-4: gather context in parallel where safe ----------
  await audit("context-graph", "start");
  const graph = await buildGraphSnapshot();
  await audit("context-graph", graph.available ? "ok" : "error", {
    available: graph.available,
    error: graph.error,
    nodeKinds: Object.keys(graph.node_counts).length,
  });

  await audit("context-projects", "start");
  const projects = await buildProjectsYamlSummary();
  await audit("context-projects", projects.available ? "ok" : "error", {
    available: projects.available,
    error: projects.error,
    total: projects.total,
    gaps: projects.gaps.length,
  });

  await audit("context-audit", "start");
  const auditWindow = await buildAuditWindow({ windowStart, windowEnd });
  await audit("context-audit", auditWindow.available ? "ok" : "error", {
    total_entries: auditWindow.total_entries,
    error: auditWindow.error,
  });

  await audit("context-github", "start");
  const openPRs = await fetchOpenPRs({ maxPRs: 30 });
  const recentIssues = await fetchRecentIssues({
    windowStart,
    maxIssues: 20,
  });
  const commits = await fetchCommitActivity({
    windowStart,
    maxRepos: 30,
  });
  await audit("context-github", "ok", {
    openPRs: openPRs.items.length,
    openPRsAvailable: openPRs.available,
    openPRsError: openPRs.error,
    recentIssues: recentIssues.items.length,
    issuesAvailable: recentIssues.available,
    issuesError: recentIssues.error,
    repos: commits.items.length,
    commitsAvailable: commits.available,
    commitsError: commits.error,
  });

  const sourceContext = {
    kind: input.kind,
    date,
    windowStart,
    windowEnd,
    graph: {
      node_counts: graph.node_counts,
      edge_counts: graph.edge_counts,
      project_count: graph.project_count,
      protected_projects: graph.protected_projects,
    },
    projects_yaml_summary: {
      total: projects.total,
      by_visibility: projects.by_visibility,
      gaps: projects.gaps,
    },
    audit_window: {
      total_entries: auditWindow.total_entries,
      by_outcome: auditWindow.by_outcome,
      by_workflow: auditWindow.by_workflow,
    },
    recent_repo_activity: commits.items,
    open_prs: openPRs.items,
    recent_issues: recentIssues.items,
    _availability: {
      graph: graph.available,
      projects: projects.available,
      audit: auditWindow.available,
      github_prs: openPRs.available,
      github_issues: recentIssues.available,
      github_commits: commits.available,
    },
  };

  // ---------- Step 5: persist pending ----------
  await audit("persist-pending", "start");
  const { briefId } = await insertPendingBrief({
    runId,
    date,
    kind: input.kind,
    sourceContext,
  });
  await audit("persist-pending", "ok", { briefId });

  if (input.dryRun) {
    await audit("dispatch-compose", "skip", { reason: "dryRun=true" });
    return { runId, briefId, status: "ready" };
  }

  // ---------- Step 6: dispatch worker job ----------
  await audit("dispatch-compose", "start");
  const composePayload = {
    kind: input.kind,
    date,
    windowStart,
    windowEnd,
    graph: sourceContext.graph,
    projects_yaml_summary: sourceContext.projects_yaml_summary,
    audit_window: sourceContext.audit_window,
    recent_repo_activity: sourceContext.recent_repo_activity,
    open_prs: sourceContext.open_prs,
    recent_issues: sourceContext.recent_issues,
  };
  const dispatch = await dispatchJob("claude-brief-compose", composePayload, {
    idempotencyKey: `${runId}:compose`,
    maxAttempts: 2,
  });
  await audit("dispatch-compose", "ok", { jobId: dispatch.jobId });
  await updateBriefStatus({
    runId,
    status: "composing",
    jobId: dispatch.jobId,
  });

  // ---------- Step 7: wait for worker ----------
  // We deliberately do NOT use waitForJob — its long-running poll dies
  // unrecoverably when the app process restarts mid-flight. Instead, each
  // poll is its own short step; if the job is still in flight we sleep
  // via the WDK clock (durable) and retry. This pattern survives full
  // process restarts and tracks with M3's documented gotcha about
  // waitForEvent/sendEvent silent degradation.
  await audit("wait-compose", "start", { jobId: dispatch.jobId });
  const deadline = Date.now() + WORKER_TIMEOUT_MS;
  let result = await pollJobOnce(dispatch.jobId);
  while (result === null && Date.now() < deadline) {
    await sleep(4000);
    result = await pollJobOnce(dispatch.jobId);
  }
  if (result === null) {
    await audit("wait-compose", "error", {
      reason: "timeout",
      jobId: dispatch.jobId,
    });
    await updateBriefStatus({
      runId,
      status: "failed",
      errorText: `wait-compose timeout after ${WORKER_TIMEOUT_MS}ms`,
    });
    return {
      runId,
      briefId,
      status: "failed",
      jobId: dispatch.jobId,
      error: `wait-compose timeout after ${WORKER_TIMEOUT_MS}ms`,
    };
  }
  await audit("wait-compose", result.status === "done" ? "ok" : "error", {
    status: result.status,
    attempts: result.attempts,
    errorText: result.errorText?.slice(0, 240),
  });

  if (result.status !== "done") {
    await updateBriefStatus({
      runId,
      status: "failed",
      errorText: result.errorText ?? `compose ${result.status}`,
    });
    return {
      runId,
      briefId,
      status: "failed",
      jobId: dispatch.jobId,
      error: result.errorText ?? `compose ${result.status}`,
    };
  }

  // ---------- Step 8: validate + finalize ----------
  const parsed = BriefOutputSchema.safeParse(result.result);
  if (!parsed.success) {
    const err = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    await audit("validate", "error", { issues: err });
    await updateBriefStatus({
      runId,
      status: "failed",
      errorText: `validation failed: ${err}`,
    });
    return {
      runId,
      briefId,
      status: "failed",
      jobId: dispatch.jobId,
      error: `validation failed: ${err}`,
    };
  }
  const output = parsed.data;
  const renderedFallback = renderBriefMarkdown(output, {
    kind: input.kind,
    date,
  });
  const bodyMarkdown =
    output.body_markdown && output.body_markdown.trim().length > 0
      ? output.body_markdown
      : renderedFallback;

  await audit("finalize", "start", {
    bodyLength: bodyMarkdown.length,
    insightCount: output.insights.length,
    actionCount: output.next_actions.length,
    questionCount: output.questions.length,
  });
  await finalizeBrief({
    runId,
    summary: output.summary,
    bodyMarkdown,
    output,
  });

  let diskPath: string | undefined;
  try {
    const r = await mirrorBriefToDisk({
      date,
      kind: input.kind,
      bodyMarkdown,
      runId,
    });
    diskPath = r.path;
    await audit("mirror-disk", "ok", { path: r.path });
  } catch (err) {
    await audit("mirror-disk", "error", { error: (err as Error).message });
  }
  await audit("complete", "ok", { briefId, diskPath });

  return {
    runId,
    briefId,
    status: "ready",
    jobId: dispatch.jobId,
    diskPath,
  };
}
