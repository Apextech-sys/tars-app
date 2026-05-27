/**
 * POST /api/tars/pr-review/disagreement-action
 *
 * Closes a `disagreed` PR-review run by performing one of four manual
 * adjudication actions on behalf of Shaun:
 *
 *   - "post-codex"   — post Codex's findings to the PR
 *   - "post-claude"  — post Claude's findings to the PR
 *   - "post-merged"  — post a deduped union of both reviewer sets
 *   - "dismiss"      — record dismissal, no GitHub call
 *
 * For posting actions the route uses the same Octokit auth as the agree-path
 * workflow (GH_TOKEN env var via lib/pr-review/github-client.ts) and the same
 * per-finding renderer (lib/pr-review/renderer.ts) so the resulting comment
 * is byte-identical at the finding level to an automated agree-path comment.
 *
 * Idempotency: if `adjudication_action` is already set on the row the route
 * returns 409 and does NOT post a second comment. On Octokit failure the
 * route writes an audit_log row with status='error' and leaves
 * adjudication_action NULL so a retry is possible from the dashboard.
 */

import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLog, prReviewRuns } from "@/lib/db/tars-schema";
import { postPRCommentDirect } from "@/lib/pr-review/github-client";
import {
  dedupeFindings,
  renderAdjudicatedComment,
  type RawReviewerFinding,
} from "@/lib/pr-review/renderer";

export const runtime = "nodejs";

const bodySchema = z.object({
  runId: z.string().min(1),
  action: z.enum(["post-codex", "post-claude", "post-merged", "dismiss"]),
});

type Action = z.infer<typeof bodySchema>["action"];

interface DisagreedPayloadShape {
  codex?: {
    summary?: string;
    findings?: RawReviewerFinding[];
  };
  claude?: {
    summary?: string;
    findings?: RawReviewerFinding[];
  };
  overlapRatio?: number;
}

interface PolicyShape {
  protectMode?: boolean;
}

function pickFindings(
  payload: DisagreedPayloadShape | null | undefined,
  reviewer: "codex" | "claude"
): RawReviewerFinding[] {
  if (!payload) return [];
  const set = payload[reviewer];
  if (!set || !Array.isArray(set.findings)) return [];
  return set.findings;
}

function actionHeader(action: Action): string {
  switch (action) {
    case "post-codex":
      return "Codex findings (Claude disagreed)";
    case "post-claude":
      return "Claude findings (Codex disagreed)";
    case "post-merged":
      return "Merged findings (manually adjudicated)";
    default:
      return "PR Review (adjudicated)";
  }
}

function actionNote(action: Action): string {
  switch (action) {
    case "post-codex":
      return (
        "Posted manually by Shaun after Codex/Claude disagreement. " +
        "Only Codex's findings are shown below — Claude flagged a different set."
      );
    case "post-claude":
      return (
        "Posted manually by Shaun after Codex/Claude disagreement. " +
        "Only Claude's findings are shown below — Codex flagged a different set."
      );
    case "post-merged":
      return (
        "Posted manually by Shaun after Codex/Claude disagreement. " +
        "The findings below are the deduped union of both reviewer sets."
      );
    default:
      return "Manually adjudicated.";
  }
}

async function writeAuditRow(args: {
  runId: string;
  owner: string;
  repo: string;
  prNumber: number;
  status: "ok" | "error";
  message?: string;
  data: Record<string, unknown>;
}): Promise<void> {
  await db.insert(auditLog).values({
    runId: args.runId,
    workflow: "pr-review",
    step: "adjudication-post",
    status: args.status,
    owner: args.owner,
    repo: args.repo,
    prNumber: args.prNumber,
    message: args.message ?? null,
    data: args.data,
  });
}

export async function POST(req: NextRequest) {
  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", issues: err.issues },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "Malformed body" }, { status: 400 });
  }

  const { runId, action } = parsed;

  // Load run row.
  const rows = await db
    .select({
      runId: prReviewRuns.runId,
      owner: prReviewRuns.owner,
      repo: prReviewRuns.repo,
      prNumber: prReviewRuns.prNumber,
      prSha: prReviewRuns.prSha,
      status: prReviewRuns.status,
      policy: prReviewRuns.policy,
      disagreedPayload: prReviewRuns.disagreedPayload,
      adjudicationAction: prReviewRuns.adjudicationAction,
    })
    .from(prReviewRuns)
    .where(eq(prReviewRuns.runId, runId))
    .limit(1);

  if (rows.length === 0) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  const run = rows[0];

  if (run.status !== "disagreed") {
    return NextResponse.json(
      { error: `Run is in state "${run.status}", not "disagreed"` },
      { status: 409 }
    );
  }

  // Idempotency: refuse to double-post.
  if (run.adjudicationAction) {
    return NextResponse.json(
      {
        error: `Run is already adjudicated as "${run.adjudicationAction}"`,
        adjudicationAction: run.adjudicationAction,
      },
      { status: 409 }
    );
  }

  // Belt-and-suspenders Konverge guard. The disagreed state cannot be reached
  // for a Konverge PR (Step 1 of the workflow short-circuits to
  // blocked-konverge before any reviewer runs) but we re-check here so a
  // future refactor of the workflow cannot accidentally open a write hole.
  const policy = (run.policy as PolicyShape | null) ?? null;
  if (policy?.protectMode) {
    return NextResponse.json(
      {
        error:
          "Run is policy-protected (protectMode=true) — refusing to post adjudication comment.",
      },
      { status: 403 }
    );
  }

  // Dismiss is a fast path with no GitHub call.
  if (action === "dismiss") {
    await db
      .update(prReviewRuns)
      .set({
        adjudicationAction: action,
        adjudicationActionAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(prReviewRuns.runId, runId));

    await writeAuditRow({
      runId,
      owner: run.owner,
      repo: run.repo,
      prNumber: run.prNumber,
      status: "ok",
      message: "dismissed as noise",
      data: { action, postedBy: "shaun" },
    });

    return NextResponse.json({ ok: true, runId, action });
  }

  // Posting actions — render then post via Octokit.
  const payload = (run.disagreedPayload as DisagreedPayloadShape | null) ?? null;
  if (!payload) {
    return NextResponse.json(
      { error: "Run is disagreed but has no disagreed_payload" },
      { status: 500 }
    );
  }

  let findings: RawReviewerFinding[];
  switch (action) {
    case "post-codex":
      findings = pickFindings(payload, "codex");
      break;
    case "post-claude":
      findings = pickFindings(payload, "claude");
      break;
    case "post-merged":
      findings = dedupeFindings([
        ...pickFindings(payload, "codex"),
        ...pickFindings(payload, "claude"),
      ]);
      break;
  }

  const body = renderAdjudicatedComment({
    header: actionHeader(action),
    findings,
    overlapRatio: payload.overlapRatio,
    note: actionNote(action),
    prSha: run.prSha ?? undefined,
    adjudicatedBy: "Shaun (manual adjudication)",
  });

  let commentUrl: string;
  let commentId: number;
  try {
    const posted = await postPRCommentDirect(
      run.owner,
      run.repo,
      run.prNumber,
      body
    );
    commentUrl = posted.url;
    commentId = posted.id;
  } catch (err) {
    const message =
      err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    await writeAuditRow({
      runId,
      owner: run.owner,
      repo: run.repo,
      prNumber: run.prNumber,
      status: "error",
      message: message.slice(0, 1000),
      data: { action, error: message.slice(0, 2000), postedBy: "shaun" },
    });
    return NextResponse.json(
      { error: "Failed to post PR comment", detail: message },
      { status: 500 }
    );
  }

  // Persist the adjudication once the post succeeded.
  await db
    .update(prReviewRuns)
    .set({
      adjudicationAction: action,
      adjudicationActionAt: new Date(),
      reviewCommentUrl: commentUrl,
      updatedAt: new Date(),
    })
    .where(eq(prReviewRuns.runId, runId));

  await writeAuditRow({
    runId,
    owner: run.owner,
    repo: run.repo,
    prNumber: run.prNumber,
    status: "ok",
    message: `posted adjudicated comment (${action})`,
    data: {
      action,
      commentUrl,
      commentId,
      findingsPosted: findings.length,
      postedBy: "shaun",
    },
  });

  return NextResponse.json({
    ok: true,
    runId,
    action,
    commentUrl,
    commentId,
    findingsPosted: findings.length,
  });
}
