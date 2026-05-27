import { AlertCircle, AlertTriangle, CheckCircle2, Clock, Shield } from "lucide-react";
import type { AuditLogRow, PolicyConfig, PrRun } from "./types";
import { SeverityBadge } from "./status-badge";

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

function extractFindingsFromAuditLog(auditRows: AuditLogRow[]): FindingFromLog[] {
  // Look for the synthesize or aggregate step in audit log
  const synthesizeRow = auditRows.find(
    (r) => r.step === "synthesize" || r.step === "aggregate" || r.step === "findings"
  );
  if (!synthesizeRow?.data) return [];

  const data = synthesizeRow.data as Record<string, unknown>;
  if (Array.isArray(data.findings)) {
    return data.findings as FindingFromLog[];
  }
  if (data.result && typeof data.result === "object") {
    const result = data.result as Record<string, unknown>;
    if (Array.isArray(result.findings)) return result.findings as FindingFromLog[];
  }
  return [];
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

export function FindingsSummary({
  run,
  auditRows,
}: {
  run: PrRun;
  auditRows: AuditLogRow[];
}) {
  const policy = run.policy as PolicyConfig | null;

  if (run.status === "completed") {
    const findings = extractFindingsFromAuditLog(auditRows);
    if (findings.length === 0 && run.findingsCount > 0) {
      return (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
          <div className="flex items-center gap-2 text-emerald-400">
            <CheckCircle2 className="size-4" />
            <span className="font-medium text-sm">
              {run.findingsCount} finding{run.findingsCount !== 1 ? "s" : ""} — review posted
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
        <p className="text-xs text-muted-foreground">
          {findings.length} finding{findings.length !== 1 ? "s" : ""} surfaced
        </p>
        {findings.map((f, i) => {
          const filePath = f.file ?? f.filePath ?? "unknown";
          const line = String(f.line ?? f.lineNumber ?? "?");
          const text = f.suggestion ?? f.message ?? f.description ?? "(no detail)";
          const severity = f.severity ?? "MINOR";

          return (
            <div
              key={`${filePath}-${line}-${i}`}
              className="rounded-md border border-border bg-card/50 p-3 space-y-2"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <SeverityBadge severity={severity} />
                <code className="text-xs font-mono text-muted-foreground">
                  {filePath}:{line}
                </code>
              </div>
              <p className="text-sm text-foreground/80 leading-relaxed">{text}</p>
            </div>
          );
        })}
      </div>
    );
  }

  if (run.status === "disagreed") {
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
          <span className="text-sm">No findings — no comment posted to GitHub</span>
        </div>
      </div>
    );
  }

  if (run.status === "skipped-policy") {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-900/30 p-4">
        <div className="flex items-center gap-2 text-zinc-400">
          <Shield className="size-4" />
          <span className="text-sm">Skipped by policy — auto-fix disabled for this repo</span>
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
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 space-y-2">
        <div className="flex items-center gap-2 text-amber-400">
          <Shield className="size-4" />
          <span className="font-medium text-sm">Blocked by Konverge protect_mode</span>
        </div>
        {pattern && (
          <p className="text-xs text-amber-300/70">
            Matched pattern:{" "}
            <code className="font-mono bg-amber-950/40 px-1 py-0.5 rounded">
              {pattern}
            </code>
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          This repo has protectedMode active. No analysis was performed and no comment was posted.
        </p>
      </div>
    );
  }

  if (run.status === "error") {
    return (
      <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 space-y-2">
        <div className="flex items-center gap-2 text-red-400">
          <AlertTriangle className="size-4" />
          <span className="font-medium text-sm">Run errored</span>
        </div>
        {run.error && (
          <p className="text-xs font-mono text-red-300/80 bg-red-950/40 rounded p-2 break-all">
            {run.error}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Check the Audit Timeline below for the failing step. Retry by re-opening the PR.
        </p>
      </div>
    );
  }

  if (run.status === "started") {
    const lastStep = auditRows[auditRows.length - 1];
    return (
      <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4 space-y-2">
        <div className="flex items-center gap-2 text-blue-400">
          <Clock className="size-4 animate-pulse" />
          <span className="font-medium text-sm">Run in progress</span>
        </div>
        {lastStep && (
          <p className="text-xs text-muted-foreground">
            Last step:{" "}
            <span className="font-medium text-foreground/70">{lastStep.step}</span>
            {" — "}
            {relativeTime(lastStep.createdAt)}
          </p>
        )}
      </div>
    );
  }

  return null;
}
