import type { LucideIcon } from "lucide-react";
import {
  ArrowLeft,
  Bot,
  GitCompareArrows,
  ListChecks,
  ScrollText,
  ShieldCheck,
  Webhook,
  Workflow,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { JSX, ReactNode } from "react";
import { ApprovalPanel } from "@/components/pr-runs/approval-panel";
import { AuditTimeline } from "@/components/pr-runs/audit-timeline";
import { DisagreementPanel } from "@/components/pr-runs/disagreement-panel";
import { FindingsLedger } from "@/components/pr-runs/findings-ledger";
import { FixPanel } from "@/components/pr-runs/fix-panel";
import { PipelineStepper } from "@/components/pr-runs/pipeline-stepper";
import { ReviewerCompare } from "@/components/pr-runs/reviewer-compare";
import { RunDetailHeader } from "@/components/pr-runs/run-detail-header";
import type {
  AgreedFinding,
  AuditLogRow,
  DebateTranscript,
  DisagreementPayload,
  FindingItem,
  FixBlastRadius,
  FixRevalidationItem,
  FixTestGate,
  PolicyConfig,
  PrRun,
  PrRunDetail,
} from "@/components/pr-runs/types";
import { WebhookEventCard } from "@/components/pr-runs/webhook-event-card";
import { WorkerJobsTable } from "@/components/pr-runs/worker-jobs-table";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIX_STATES = new Set(["fixing", "fix-in-review", "fix-failed", "done"]);
const GATE_STATES = new Set([
  "pending-approval",
  "approved",
  "rejected",
  "fixing",
  "fix-in-review",
  "fix-failed",
  "done",
]);

async function fetchRunDetail(runId: string): Promise<PrRunDetail | null> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";
  try {
    const res = await fetch(
      `${baseUrl}/api/tars/pr-runs/${encodeURIComponent(runId)}`,
      { cache: "no-store" }
    );
    if (!res.ok) {
      return null;
    }
    return res.json() as Promise<PrRunDetail>;
  } catch {
    return null;
  }
}

function auditSpanMs(rows: AuditLogRow[]): number | null {
  if (rows.length === 0) {
    return null;
  }
  const times = rows.map((r) => new Date(r.createdAt).getTime());
  const span = Math.max(...times) - Math.min(...times);
  return span > 0 ? span : null;
}

interface SeverityCounts {
  critical: number;
  major: number;
  minor: number;
}

function bumpSeverity(counts: SeverityCounts, severity: string | undefined) {
  const s = (severity ?? "minor").toLowerCase();
  if (s === "critical" || s === "crit" || s === "blocker") {
    counts.critical += 1;
    return;
  }
  if (s === "high" || s === "major") {
    counts.major += 1;
    return;
  }
  counts.minor += 1;
}

function severityKey(
  file: string | undefined,
  line: unknown,
  title: string
): string {
  return `${file ?? "x"}:${String(line ?? "n")}:${title.slice(0, 48)}`;
}

function reviewerTitle(f: FindingItem): string {
  const t = (f as { title?: string }).title;
  if (typeof t === "string") {
    return t;
  }
  return f.message ?? f.description ?? "";
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: breadth of independent branches/panels in one cohesive view-builder, not tangled control flow; splitting would scatter co-located UI logic
function computeSeverity(
  agreed: AgreedFinding[],
  payload: DisagreementPayload | null
): { counts: SeverityCounts; total: number } {
  const counts: SeverityCounts = { critical: 0, major: 0, minor: 0 };
  const seen = new Set<string>();
  for (const f of agreed) {
    const key = severityKey(f.file, f.line, f.message ?? "");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    bumpSeverity(counts, f.severity);
  }
  const reviewers: FindingItem[][] = [
    payload?.codex?.findings ?? [],
    payload?.claude?.findings ?? [],
  ];
  for (const list of reviewers) {
    for (const f of list) {
      const key = severityKey(
        f.file ?? f.filePath,
        f.line ?? f.lineNumber,
        reviewerTitle(f)
      );
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      bumpSeverity(
        counts,
        typeof f.severity === "string" ? f.severity : undefined
      );
    }
  }
  const total = counts.critical + counts.major + counts.minor;
  return { counts, total };
}

function Section({
  icon: Icon,
  title,
  accent,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  accent?: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className={`rounded-xl border bg-card/30 p-5 ${accent ?? ""}`}>
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" />
          <h2 className="font-semibold text-base">{title}</h2>
        </div>
        {description ? (
          <p className="mt-1 text-muted-foreground text-xs leading-relaxed">
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the detail page is the composition root that conditionally assembles every pipeline-stage section (header, stepper, reviewer compare, findings, gate, fix, forensic trail) from a single run payload; the branching mirrors the run lifecycle and is clearer kept inline than scattered across wrappers.
export default async function PrRunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}): Promise<JSX.Element> {
  const { runId } = await params;
  const detail = await fetchRunDetail(runId);

  if (!detail) {
    notFound();
  }

  const detailData = detail as PrRunDetail;
  const run = detailData.run as PrRun;
  const auditLog = detailData.auditLog;
  const webhookEvent = detailData.webhookEvent;
  const jobs = detailData.jobs;
  const policy = run.policy as PolicyConfig | null;
  const agreementThreshold =
    typeof policy?.agreementThreshold === "number"
      ? policy.agreementThreshold
      : 0.7;

  const durationMs = auditSpanMs(auditLog);
  const agreedFindings = (run.agreedFindings as AgreedFinding[] | null) ?? [];
  const disagreedPayload =
    run.disagreedPayload === null || run.disagreedPayload === undefined
      ? null
      : (run.disagreedPayload as DisagreementPayload);
  const debate = (run.debateRounds as DebateTranscript | null) ?? null;
  const { counts: severityCounts, total: totalFindings } = computeSeverity(
    agreedFindings,
    disagreedPayload
  );

  const hasReviewerData =
    Boolean(disagreedPayload) || (debate?.rounds?.length ?? 0) > 0;
  const showGate = GATE_STATES.has(run.status);
  const showFix = FIX_STATES.has(run.status);
  const showDisagreement =
    run.status === "disagreed" && disagreedPayload !== null;
  const gateStatus =
    run.status === "pending-approval" || run.status === "rejected"
      ? run.status
      : "approved";

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <div>
        <Link
          className="inline-flex items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
          href="/pr-runs"
        >
          <ArrowLeft className="size-3.5" />
          All PR runs
        </Link>
      </div>

      <RunDetailHeader
        durationMs={durationMs}
        prTitle={run.prTitle ?? webhookEvent?.prTitle ?? null}
        run={run}
        severityCounts={severityCounts}
        totalFindings={totalFindings}
      />

      {/* Flagship — staged pipeline timeline */}
      <Section
        description="The dual-AI review as named stages. Per-stage timing shows where the run spent its time; tap a stage for its raw audit steps."
        icon={Workflow}
        title="Review pipeline"
      >
        <PipelineStepper rows={auditLog} />
      </Section>

      {/* Flagship — Claude vs Codex side-by-side */}
      {hasReviewerData ? (
        <Section
          description="Both reviewers on the same PR. The agreement meter shows how much they converged; toggle to step through each debate round."
          icon={GitCompareArrows}
          title="Claude vs Codex"
        >
          <ReviewerCompare debate={debate} payload={disagreedPayload} />
        </Section>
      ) : null}

      {/* Unified findings ledger */}
      <Section
        description="Every finding raised on this run, severity-ranked, with the reviewer(s) who raised it."
        icon={ListChecks}
        title="Findings ledger"
      >
        <FindingsLedger
          agreedFindings={agreedFindings}
          disagreedPayload={disagreedPayload}
        />
      </Section>

      {/* Adjudication — disagreement variant */}
      {showDisagreement ? (
        <Section
          accent="border-purple-500/20"
          description="Codex and Claude diverged. Adjudicate by posting one side's findings, a merged set, or dismissing as noise."
          icon={ShieldCheck}
          title="Adjudication gate"
        >
          <DisagreementPanel
            adjudicationAction={run.adjudicationAction}
            agreementThreshold={agreementThreshold}
            payload={disagreedPayload as DisagreementPayload}
            runId={run.runId}
          />
        </Section>
      ) : null}

      {/* Approval gate */}
      {showGate ? (
        <Section
          accent="border-sky-500/20"
          description="Nothing is written to the PR or fixed until you approve the agreed findings."
          icon={ShieldCheck}
          title="Approval gate"
        >
          <ApprovalPanel
            approvalAction={run.approvalAction}
            approvalReason={run.approvalReason}
            findings={agreedFindings}
            linearIssueIdentifier={run.linearIssueIdentifier}
            linearIssueUrl={run.linearIssueUrl}
            runId={run.runId}
            status={gateStatus}
          />
        </Section>
      ) : null}

      {/* Fix stage */}
      {showFix ? (
        <Section
          accent="border-cyan-500/20"
          description="TARS applies the approved fix within its blast radius, then runs a baseline-diff test gate before opening a PR. It never merges its own fix."
          icon={Wrench}
          title="Fix stage"
        >
          <FixPanel
            error={run.error}
            fixBlastRadius={
              (run.fixBlastRadius as FixBlastRadius | null) ?? null
            }
            fixBranch={run.fixBranch}
            fixCoverageRootcause={run.fixCoverageRootcause}
            fixPrNumber={run.fixPrNumber}
            fixPrUrl={run.fixPrUrl}
            fixRevalidation={
              (run.fixRevalidation as FixRevalidationItem[] | null) ?? null
            }
            fixStatus={run.fixStatus}
            fixTestGate={(run.fixTestGate as FixTestGate | null) ?? null}
            runId={run.runId}
            status={run.status}
          />
        </Section>
      ) : null}

      {/* Forensic — full chronological audit trail, collapsed */}
      <details className="group rounded-xl border bg-card/30">
        <summary className="flex cursor-pointer list-none items-center gap-2 p-5">
          <ScrollText className="size-4 text-muted-foreground" />
          <h2 className="font-semibold text-base">Full audit trail</h2>
          <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs tabular-nums">
            {auditLog.length}
          </span>
          <span className="ml-auto text-muted-foreground text-xs transition-transform group-open:rotate-90">
            ›
          </span>
        </summary>
        <div className="border-t p-5">
          <AuditTimeline rows={auditLog} />
        </div>
      </details>

      {/* Worker jobs — only when jobs exist */}
      {jobs.length > 0 ? (
        <Section icon={Bot} title="Worker jobs">
          <WorkerJobsTable archivedAt={run.archivedAt} jobs={jobs} />
        </Section>
      ) : null}

      {/* Webhook event — only when linked */}
      {webhookEvent ? (
        <Section icon={Webhook} title="Triggering webhook">
          <WebhookEventCard event={webhookEvent} />
        </Section>
      ) : null}
    </div>
  );
}
