/**
 * Linear issue lifecycle helpers for the PR-review pipeline (Slice 1).
 *
 * These are the WRITE-side counterparts to the read/comment helpers in
 * `lib/tars/linear.ts` (which serve the inbound chat adapter). They are kept
 * separate and dependency-light (raw GraphQL over `fetch`, no `@linear/sdk`)
 * so they can be called from `"use step"` workflow code without dragging the
 * heavy SDK across the WDK compilation boundary.
 *
 * Lifecycle covered by Slice 1:
 *   - createIssue:  called when a run reaches `pending-approval`. Creates a
 *                   REF issue in the team's "Triage" state describing the PR
 *                   and the agreed findings.
 *   - transitionIssue: called from the approval-action route on approve
 *                   (-> In Progress) / reject (-> Canceled).
 *
 * State selection is dynamic: we query the team's workflow states and pick by
 * name first, falling back to Linear's state `type` so a rename of a column
 * in Linear can't silently break the transition.
 */

const LINEAR_GQL = "https://api.linear.app/graphql";

interface LinearGqlResp<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

function linearApiKey(): string {
  const key = process.env.LINEAR_API_KEY;
  if (!key) {
    throw new Error("LINEAR_API_KEY env var not set");
  }
  return key;
}

async function gql<T>(
  query: string,
  variables: Record<string, unknown>,
  fetchImpl?: typeof fetch
): Promise<LinearGqlResp<T>> {
  const f = fetchImpl ?? fetch;
  const res = await f(LINEAR_GQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: linearApiKey(),
    },
    body: JSON.stringify({ query, variables }),
  });
  return (await res.json()) as LinearGqlResp<T>;
}

export interface LinearState {
  id: string;
  name: string;
  type: string;
}

export interface LinearTeamRef {
  id: string;
  key: string;
  name: string;
}

/**
 * Resolve a team by its key (e.g. "REF") and return its id + workflow states.
 * Returns null if no team matches the key.
 *
 * Two-step on purpose: requesting `states` for every team in one query blows
 * past Linear's 10k query-complexity ceiling (complexity ~16.5k for ~250
 * teams). So we first fetch the lightweight team list to find the id, then
 * fetch just that one team's workflow states.
 */
export async function resolveTeamByKey(
  teamKey: string,
  fetchImpl?: typeof fetch
): Promise<{ team: LinearTeamRef; states: LinearState[] } | null> {
  const listJson = await gql<{
    teams?: {
      nodes: Array<{ id: string; key: string; name: string }>;
    };
  }>(
    "query Teams { teams(first: 250) { nodes { id key name } } }",
    {},
    fetchImpl
  );
  const nodes = listJson.data?.teams?.nodes ?? [];
  const match = nodes.find(
    (t) => t.key.toLowerCase() === teamKey.toLowerCase()
  );
  if (!match) {
    return null;
  }

  const stateJson = await gql<{
    team?: { states: { nodes: LinearState[] } };
  }>(
    `query TeamStates($id: String!) {
      team(id: $id) { states { nodes { id name type } } }
    }`,
    { id: match.id },
    fetchImpl
  );

  return {
    team: { id: match.id, key: match.key, name: match.name },
    states: stateJson.data?.team?.states.nodes ?? [],
  };
}

export type LifecyclePhase =
  | "pending-approval"
  | "approved"
  // Slice 2 (fix stage) phases:
  | "fixing"
  | "in-review"
  | "done"
  | "rejected";

/**
 * Pick the workflow-state id for a lifecycle phase. Name-first, type-fallback
 * so the mapping survives a column rename in Linear.
 *
 * Slice 2 adds the fix-stage phases:
 *   - "fixing"    -> In Progress (the run is approved; Claude Code is fixing).
 *   - "in-review" -> In Review (the fix PR is open, awaiting human review).
 *   - "done"      -> Done       (the fix PR merged).
 */
export function pickStateForPhase(
  states: LinearState[],
  phase: LifecyclePhase
): LinearState | null {
  const byName = (name: string) =>
    states.find((s) => s.name.toLowerCase() === name.toLowerCase());
  const byType = (type: string) => states.find((s) => s.type === type);

  if (phase === "pending-approval") {
    return (
      byName("Triage") ??
      byType("triage") ??
      byName("Todo") ??
      byType("unstarted") ??
      null
    );
  }
  if (phase === "approved" || phase === "fixing") {
    return byName("In Progress") ?? byType("started") ?? null;
  }
  if (phase === "in-review") {
    return (
      byName("In Review") ??
      byName("Code Review") ??
      byName("Review") ??
      // Linear's "review"-flavoured states are still type `started`; only fall
      // back to the generic started state if no review column exists.
      byType("started") ??
      null
    );
  }
  if (phase === "done") {
    return byName("Done") ?? byType("completed") ?? null;
  }
  // rejected
  return byName("Canceled") ?? byType("canceled") ?? null;
}

export interface CreatedLinearIssue {
  id: string;
  identifier: string;
  url: string;
}

/**
 * Create a Linear issue for a PR-review run that has reached pending-approval.
 * The issue is created directly in the pending-approval state (Triage).
 */
export async function createPrReviewIssue(args: {
  teamKey: string;
  title: string;
  description: string;
  fetchImpl?: typeof fetch;
}): Promise<
  { ok: true; issue: CreatedLinearIssue } | { ok: false; error: string }
> {
  const resolved = await resolveTeamByKey(args.teamKey, args.fetchImpl);
  if (!resolved) {
    return { ok: false, error: `Linear team "${args.teamKey}" not found` };
  }
  const state = pickStateForPhase(resolved.states, "pending-approval");

  const json = await gql<{
    issueCreate?: {
      success: boolean;
      issue?: { id: string; identifier: string; url: string };
    };
  }>(
    `mutation IssueCreate($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { id identifier url }
      }
    }`,
    {
      input: {
        teamId: resolved.team.id,
        title: args.title,
        description: args.description,
        ...(state ? { stateId: state.id } : {}),
      },
    },
    args.fetchImpl
  );

  if (json.errors && json.errors.length > 0) {
    return { ok: false, error: json.errors.map((e) => e.message).join("; ") };
  }
  const issue = json.data?.issueCreate?.issue;
  if (!(json.data?.issueCreate?.success && issue)) {
    return { ok: false, error: "issueCreate.success=false" };
  }
  return { ok: true, issue };
}

/**
 * Transition an existing Linear issue to the state for a lifecycle phase.
 */
export async function transitionPrReviewIssue(args: {
  teamKey: string;
  issueId: string;
  phase: LifecyclePhase;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; stateName: string } | { ok: false; error: string }> {
  const resolved = await resolveTeamByKey(args.teamKey, args.fetchImpl);
  if (!resolved) {
    return { ok: false, error: `Linear team "${args.teamKey}" not found` };
  }
  const state = pickStateForPhase(resolved.states, args.phase);
  if (!state) {
    return {
      ok: false,
      error: `No workflow state found for phase "${args.phase}" in team ${args.teamKey}`,
    };
  }

  const json = await gql<{
    issueUpdate?: { success: boolean };
  }>(
    `mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) { success }
    }`,
    { id: args.issueId, input: { stateId: state.id } },
    args.fetchImpl
  );

  if (json.errors && json.errors.length > 0) {
    return { ok: false, error: json.errors.map((e) => e.message).join("; ") };
  }
  if (!json.data?.issueUpdate?.success) {
    return { ok: false, error: "issueUpdate.success=false" };
  }
  return { ok: true, stateName: state.name };
}

export interface AgreedFindingForIssue {
  severity: string;
  file: string;
  line?: number;
  message: string;
  suggestion?: string;
}

/**
 * Build the Linear issue title + markdown body for a pending-approval run.
 * Title: `[PR review] owner/repo#N: <short>`. Body carries the findings list,
 * a PR link, the head SHA, and §11-style contract fields.
 */
export function buildIssueContent(args: {
  owner: string;
  repo: string;
  prNumber: number;
  prTitle?: string | null;
  prUrl: string;
  prSha?: string | null;
  findings: AgreedFindingForIssue[];
  runId: string;
}): { title: string; description: string } {
  const short =
    (args.prTitle ?? "").trim().slice(0, 80) || `PR #${args.prNumber}`;
  const title = `[PR review] ${args.owner}/${args.repo}#${args.prNumber}: ${short}`;

  const lines: string[] = [];
  lines.push(
    `TARS dual-AI review (Codex + Claude) agreed on **${args.findings.length} finding${args.findings.length === 1 ? "" : "s"}** on this PR. Awaiting Shaun's approval before any fix work begins.`
  );
  lines.push("");
  lines.push("## Findings");
  if (args.findings.length === 0) {
    lines.push("_No findings above threshold._");
  } else {
    for (const f of args.findings) {
      const loc = f.line ? `${f.file}:${f.line}` : f.file;
      lines.push(
        `- **[${f.severity.toUpperCase()}]** \`${loc}\` — ${f.message}`
      );
      if (f.suggestion) {
        lines.push(`  - _Suggestion:_ ${f.suggestion}`);
      }
    }
  }
  lines.push("");
  lines.push("## Links");
  lines.push(`- Pull request: ${args.prUrl}`);
  if (args.prSha) {
    lines.push(`- Head SHA: \`${args.prSha.slice(0, 12)}\``);
  }
  lines.push("");
  lines.push("## §11 contract");
  lines.push(`- **Repo:** ${args.owner}/${args.repo}`);
  lines.push(`- **PR:** #${args.prNumber}`);
  lines.push(`- **TARS run:** \`${args.runId}\``);
  lines.push("- **Stage:** review-complete / pending-approval");
  lines.push(
    "- **Next:** Shaun approves -> Claude Code fix (Slice 2) -> commit + PR -> Done."
  );
  lines.push("");
  lines.push(
    "<sub>Created automatically by the TARS PR-review lifecycle. Status tracks the approval gate.</sub>"
  );
  return { title, description: lines.join("\n") };
}

/**
 * `"use step"` wrapper: create the pending-approval Linear issue. Returns the
 * created issue or null on failure (never throws — Linear being down must not
 * fail the whole review pipeline; the run still reaches pending-approval).
 */
export async function createPendingApprovalIssue(args: {
  teamKey: string;
  owner: string;
  repo: string;
  prNumber: number;
  prTitle?: string | null;
  prUrl: string;
  prSha?: string | null;
  findings: AgreedFindingForIssue[];
  runId: string;
}): Promise<CreatedLinearIssue | null> {
  "use step";
  try {
    const { title, description } = buildIssueContent(args);
    const result = await createPrReviewIssue({
      teamKey: args.teamKey,
      title,
      description,
    });
    if (result.ok) {
      return result.issue;
    }
    if (process.env.TARS_DEBUG_LINEAR) {
      console.warn("[linear] createPendingApprovalIssue failed:", result.error);
    }
    return null;
  } catch (err) {
    if (process.env.TARS_DEBUG_LINEAR) {
      console.warn(
        "[linear] createPendingApprovalIssue threw:",
        (err as Error).message
      );
    }
    return null;
  }
}

// ── Slice 2: fix-stage Linear lifecycle ──────────────────────────────────────

/** Post a markdown comment onto an existing Linear issue. */
export async function commentOnIssue(args: {
  issueId: string;
  body: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const json = await gql<{
    commentCreate?: { success: boolean };
  }>(
    `mutation CommentCreate($input: CommentCreateInput!) {
      commentCreate(input: $input) { success }
    }`,
    { input: { issueId: args.issueId, body: args.body } },
    args.fetchImpl
  );
  if (json.errors && json.errors.length > 0) {
    return { ok: false, error: json.errors.map((e) => e.message).join("; ") };
  }
  if (!json.data?.commentCreate?.success) {
    return { ok: false, error: "commentCreate.success=false" };
  }
  return { ok: true };
}

/**
 * `"use step"` wrapper: transition the run's Linear issue to a fix-stage phase.
 * Best-effort — never throws (Linear being down must not fail the fix). Returns
 * the state name on success, null on any failure.
 */
export async function transitionFixPhase(args: {
  teamKey: string;
  issueId: string;
  phase: LifecyclePhase;
}): Promise<string | null> {
  "use step";
  try {
    const result = await transitionPrReviewIssue({
      teamKey: args.teamKey,
      issueId: args.issueId,
      phase: args.phase,
    });
    if (result.ok) {
      return result.stateName;
    }
    if (process.env.TARS_DEBUG_LINEAR) {
      console.warn("[linear] transitionFixPhase failed:", result.error);
    }
    return null;
  } catch (err) {
    if (process.env.TARS_DEBUG_LINEAR) {
      console.warn(
        "[linear] transitionFixPhase threw:",
        (err as Error).message
      );
    }
    return null;
  }
}

/**
 * `"use step"` wrapper: comment a fix-PR link onto the run's Linear issue.
 * Best-effort — never throws. Returns true on success.
 */
export async function commentFixPrOnIssue(args: {
  issueId: string;
  fixPrUrl: string;
  fixSummary?: string;
  filesChanged?: string[];
  coverageRootCause?: string;
}): Promise<boolean> {
  "use step";
  try {
    const lines: string[] = [];
    lines.push(`**TARS opened a fix PR for human review:** ${args.fixPrUrl}`);
    if (args.fixSummary) {
      lines.push("");
      lines.push(args.fixSummary);
    }
    if (args.filesChanged && args.filesChanged.length > 0) {
      lines.push("");
      lines.push(
        `Files changed: ${args.filesChanged.map((f) => `\`${f}\``).join(", ")}`
      );
    }
    if (args.coverageRootCause) {
      lines.push("");
      lines.push(`_Coverage-gap root cause:_ ${args.coverageRootCause}`);
    }
    const result = await commentOnIssue({
      issueId: args.issueId,
      body: lines.join("\n"),
    });
    return result.ok;
  } catch {
    return false;
  }
}
