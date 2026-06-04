import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Shield,
} from "lucide-react";
import { SeverityBadge } from "./status-badge";
import type { AuditLogRow, PolicyConfig, PrRun } from "./types";

interface FindingFromLog {
  severity?: string;
  file?: string;
  filePath?: string;
  line?: number | string;
  lineNumber?: number | string;
  suggestion?: string;
  message?: string;
  description?: string;
}

function extractFindingsFromAuditLog(
  auditRows: AuditLogRow[]
): FindingFromLog[] {
  // Look for the synthesize or aggregate step in audit log
  const synthesizeRow = auditRows.find(
    (r) =>
      r.step === "synthesize" || r.step === "aggregate" || r.step === "findings"
  );
  if (!synthesizeRow?.data) {
    return [];
  }

  const data = synthesizeRow.data as Record<string, unknown>;
  if (Array.isArray(data.findings)) {
    return data.findings as FindingFromLog[];
  }
  if (data.result && typeof data.result === "object") {
    const result = data.result as Record<string, unknown>;
    if (Array.isArray(result.findings)) {
      return result.findings as FindingFromLog[];
    }
  }
  return [];
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) {
    return `${s}s ago`;
  }
  const m = Math.floor(s / 60);
  if (m < 60) {
    return `${m}m ${s % 60}s ago`;
  }
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

function CompletedSummary({
  run,
  auditRows,
}: {
  run: PrRun;
  auditRows: AuditLogRow[];
}) {
  const findings = extractFindingsFromAuditLog(auditRows);
  if (findings.length === 0 && run.findingsCount > 0) {
    return (
      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
        <div className="flex items-center gap-2 text-emerald-400">
          <CheckCircle2 className="size-4" />
          <span className="font-medium text-sm">
            {run.findingsCount} finding{run.findingsCount === 1 ? "" : "s"} —
            review posted
          </span>
        </div>
      </div>
    );
  }

  if (findings.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-900/30 p-4">
        <div className="flex items-center gap-2 text-zinc-400">
          <CheckCircle2 className="size-4" />
          <span className="text-sm">No findings extracted from audit log</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-xs">
        {findings.length} finding{findings.length === 1 ? "" : "s"} surfaced
      </p>
      {findings.map((f, i) => {
        const filePath = f.file ?? f.filePath ?? "unknown";
        const line = String(f.line ?? f.lineNumber ?? "?");
        const text =
          f.suggestion ?? f.message ?? f.description ?? "(no detail)";
        const severity = f.severity ?? "MINOR";

        return (
          <div
            className="space-y-2 rounded-md border border-border bg-card/50 p-3"
            // biome-ignore lint/suspicious/noArrayIndexKey: findings have no stable id and can share the same file:line; index is the only disambiguator and the list is render-only (never reordered)
            key={`${filePath}-${line}-${i}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={severity} />
              <code className="font-mono text-muted-foreground text-xs">
                {filePath}:{line}
              </code>
            </div>
            <p className="text-foreground/80 text-sm leading-relaxed">{text}</p>
          </div>
        );
      })}
    </div>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: flat per-status dispatch — one distinct presentational arm per run.status (8 statuses); extracting further would add indirection without reducing real branching risk
export function FindingsSummary({
  run,
  auditRows,
}: {
  run: PrRun;
  auditRows: AuditLogRow[];
}) {
  const policy = run.policy as PolicyConfig | null;

  if (run.status === "completed") {
    return <CompletedSummary auditRows={auditRows} run={run} />;
  }

  if (run.status === "disagreed") {
    if (
      run.archivedAt &&
      (run.disagreedPayload === null || run.disagreedPayload === undefined)
    ) {
      return (
        <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-4">
          <div className="flex items-center gap-2 text-purple-400">
            <AlertCircle className="size-4" />
            <span className="font-medium text-sm">
              Disagreement details archived; summary preserved
            </span>
          </div>
        </div>
      );
    }
    return (
      <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-4">
        <div className="flex items-center gap-2 text-purple-400">
          <AlertCircle className="size-4" />
          <span className="font-medium text-sm">
            Reviewers disagreed — see Disagreement panel below
          </span>
        </div>
      </div>
    );
  }

  if (run.status === "skipped-no-findings") {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-900/30 p-4">
        <div className="flex items-center gap-2 text-zinc-400">
          <CheckCircle2 className="size-4" />
          <span className="text-sm">
            No findings — no comment posted to GitHub
          </span>
        </div>
      </div>
    );
  }

  if (
    run.status === "pending-approval" ||
    run.status === "approved" ||
    run.status === "rejected"
  ) {
    const approvalLabels: Record<string, string> = {
      "pending-approval": "Reviewers agreed — awaiting your approval",
      approved: "Approved — fix stage authorized",
      rejected: "Rejected",
    };
    const label = approvalLabels[run.status] ?? run.status;
    return (
      <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-4">
        <div className="flex items-center gap-2 text-sky-400">
          <CheckCircle2 className="size-4" />
          <span className="font-medium text-sm">
            {run.findingsCount} agreed finding
            {run.findingsCount === 1 ? "" : "s"} — {label}
          </span>
        </div>
        <p className="mt-1 text-muted-foreground text-xs">
          See the Approval Gate panel below for the full findings and the
          Approve / Reject controls.
        </p>
      </div>
    );
  }

  if (run.status === "skipped-policy") {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-900/30 p-4">
        <div className="flex items-center gap-2 text-zinc-400">
          <Shield className="size-4" />
          <span className="text-sm">
            Skipped by policy — auto-fix disabled for this repo
          </span>
        </div>
      </div>
    );
  }

  if (run.status === "blocked-konverge") {
    const protectedMode = policy?.protectedMode;
    const pattern =
      typeof protectedMode === "object" && protectedMode !== null
        ? (protectedMode as { pattern?: string }).pattern
        : undefined;

    return (
      <div className="space-y-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
        <div className="flex items-center gap-2 text-amber-400">
          <Shield className="size-4" />
          <span className="font-medium text-sm">
            Blocked by Konverge protect_mode
          </span>
        </div>
        {pattern && (
          <p className="text-amber-300/70 text-xs">
            Matched pattern:{" "}
            <code className="rounded bg-amber-950/40 px-1 py-0.5 font-mono">
              {pattern}
            </code>
          </p>
        )}
        <p className="text-muted-foreground text-xs">
          This repo has protectedMode active. No analysis was performed and no
          comment was posted.
        </p>
      </div>
    );
  }

  if (run.status === "error") {
    return (
      <div className="space-y-2 rounded-lg border border-red-500/20 bg-red-500/5 p-4">
        <div className="flex items-center gap-2 text-red-400">
          <AlertTriangle className="size-4" />
          <span className="font-medium text-sm">Run errored</span>
        </div>
        {run.error && (
          <p className="break-all rounded bg-red-950/40 p-2 font-mono text-red-300/80 text-xs">
            {run.error}
          </p>
        )}
        <p className="text-muted-foreground text-xs">
          Check the Audit Timeline below for the failing step. Retry by
          re-opening the PR.
        </p>
      </div>
    );
  }

  if (run.status === "started") {
    const lastStep = auditRows.at(-1);
    return (
      <div className="space-y-2 rounded-lg border border-blue-500/20 bg-blue-500/5 p-4">
        <div className="flex items-center gap-2 text-blue-400">
          <Clock className="size-4 animate-pulse" />
          <span className="font-medium text-sm">Run in progress</span>
        </div>
        {lastStep && (
          <p className="text-muted-foreground text-xs">
            Last step:{" "}
            <span className="font-medium text-foreground/70">
              {lastStep.step}
            </span>
            {" — "}
            {relativeTime(lastStep.createdAt)}
          </p>
        )}
      </div>
    );
  }

  return null;
}
