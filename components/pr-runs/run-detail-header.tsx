import {
  Archive,
  Clock,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  Layers,
  ListChecks,
  MessageSquare,
  ShieldAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { RunStatusBadge } from "./status-badge";
import type { PolicyConfig, PrRun } from "./types";

type Tone = "neutral" | "good" | "warn" | "bad";

const TONE_ACCENT: Record<Tone, string> = {
  bad: "text-red-400",
  warn: "text-amber-400",
  good: "text-[#00d4a0]",
  neutral: "text-foreground",
};

function fmtDuration(ms: number | null): string {
  if (ms === null || ms <= 0) {
    return "—";
  }
  const s = Math.floor(ms / 1000);
  if (s < 60) {
    return `${s}s`;
  }
  const m = Math.floor(s / 60);
  if (m < 60) {
    return `${m}m ${s % 60}s`;
  }
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

const VERDICT_COPY: Record<string, { label: string; tone: Tone }> = {
  converged: { label: "Converged", tone: "good" },
  "max-rounds": { label: "Disputed", tone: "warn" },
  "no-findings": { label: "Clean", tone: "neutral" },
};

function StatTile({
  icon: Icon,
  label,
  value,
  sub,
  tone = "neutral",
}: {
  icon: typeof Clock;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
        <Icon className="size-4" /> {label}
      </div>
      <div
        className={cn(
          "mt-1 font-semibold text-2xl tabular-nums",
          TONE_ACCENT[tone]
        )}
      >
        {value}
      </div>
      {sub ? <div className="text-muted-foreground text-xs">{sub}</div> : null}
    </div>
  );
}

function PolicyChip({
  label,
  value,
}: {
  label: string;
  value: boolean | string | number | undefined | null;
}) {
  const isNumeric = typeof value === "number";
  const isActive =
    value === true ||
    (typeof value === "string" && value !== "false" && value !== "none");
  const display = isNumeric ? `${label}: ${value}` : label;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 font-medium text-xs",
        isActive
          ? "border-primary/30 bg-primary/10 text-primary"
          : "border-border bg-muted/40 text-muted-foreground"
      )}
    >
      {display}
      {isNumeric ? null : (
        <span className="ml-1 text-[10px] opacity-70">
          {isActive ? "on" : "off"}
        </span>
      )}
    </span>
  );
}

interface SeverityCounts {
  critical: number;
  major: number;
  minor: number;
}

interface RunDetailHeaderProps {
  run: PrRun;
  prTitle: string | null;
  durationMs: number | null;
  severityCounts: SeverityCounts;
  totalFindings: number;
}

function severityValue(counts: SeverityCounts): {
  value: ReactNode;
  tone: Tone;
} {
  const parts: { n: number; cls: string; tag: string }[] = [
    { n: counts.critical, cls: "text-red-400", tag: "C" },
    { n: counts.major, cls: "text-orange-400", tag: "M" },
    { n: counts.minor, cls: "text-yellow-400", tag: "m" },
  ];
  const active = parts.filter((p) => p.n > 0);
  let tone: Tone = "neutral";
  if (counts.critical > 0) {
    tone = "bad";
  } else if (counts.major > 0) {
    tone = "warn";
  }
  if (active.length === 0) {
    return { value: <span className="text-muted-foreground">none</span>, tone };
  }
  return {
    value: (
      <span className="flex items-center gap-2">
        {active.map((p) => (
          <span className={p.cls} key={p.tag}>
            {p.n}
            <span className="ml-0.5 text-xs opacity-70">{p.tag}</span>
          </span>
        ))}
      </span>
    ),
    tone,
  };
}

type PolicyExtras = PolicyConfig & {
  autoReview?: boolean;
  severityThreshold?: string;
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: breadth of independent branches/panels in one cohesive view-builder, not tangled control flow; splitting would scatter co-located UI logic
export function RunDetailHeader({
  run,
  prTitle,
  durationMs,
  severityCounts,
  totalFindings,
}: RunDetailHeaderProps) {
  const policy = run.policy as PolicyExtras | null;
  const ghUrl = `https://github.com/${run.owner}/${run.repo}/pull/${run.prNumber}`;
  const stopReason = run.debateRounds?.stopReason;
  const verdict = stopReason ? VERDICT_COPY[stopReason] : null;
  const verdictLabel = verdict?.label ?? "—";
  const verdictTone = verdict?.tone ?? "neutral";
  const sev = severityValue(severityCounts);
  const rounds = run.debateRounds?.rounds?.length ?? 0;

  const protectedModeEnabled =
    policy?.protectedMode === true ||
    (typeof policy?.protectedMode === "object" &&
      Boolean(policy.protectedMode?.enabled));

  return (
    <div className="space-y-5">
      {/* Title row */}
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <GitPullRequest className="size-5 shrink-0 text-muted-foreground" />
            <h1 className="font-semibold text-xl leading-tight">
              {prTitle ?? `PR #${run.prNumber}`}
            </h1>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-muted-foreground text-sm">
            <span>
              {run.owner}/{run.repo}
            </span>
            <span className="text-foreground/40">·</span>
            <span>#{run.prNumber}</span>
            {run.prSha ? (
              <>
                <span className="text-foreground/40">·</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  {run.prSha.slice(0, 7)}
                </span>
              </>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {run.archivedAt ? (
            <span
              className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2.5 py-0.5 font-medium text-muted-foreground text-xs"
              title={`Archived on ${new Date(run.archivedAt).toLocaleString()}`}
            >
              <Archive className="size-3" />
              Archived
            </span>
          ) : null}
          <RunStatusBadge status={run.status} />
        </div>
      </div>

      {/* At-a-glance verdict strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          icon={GitMerge}
          label="Verdict"
          sub={
            rounds > 0
              ? `${rounds} debate round${rounds === 1 ? "" : "s"}`
              : "single pass"
          }
          tone={verdictTone}
          value={verdictLabel}
        />
        <StatTile
          icon={Clock}
          label="Review time"
          sub="audit span"
          value={fmtDuration(durationMs)}
        />
        <StatTile
          icon={ListChecks}
          label="Findings"
          sub={totalFindings === 1 ? "1 raised" : `${totalFindings} raised`}
          tone={totalFindings > 0 ? "warn" : "good"}
          value={totalFindings}
        />
        <StatTile
          icon={ShieldAlert}
          label="Severity"
          sub="critical / major / minor"
          tone={sev.tone}
          value={sev.value}
        />
      </div>

      {/* Deep links — GitHub always; others only when present */}
      <div className="flex flex-wrap gap-2">
        <a
          aria-label={`Open PR #${run.prNumber} on GitHub`}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-sm transition-colors hover:bg-accent/50"
          href={ghUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          <ExternalLink className="size-3.5 text-muted-foreground" />
          GitHub PR
        </a>
        {run.reviewCommentUrl ? (
          <a
            aria-label="View posted review comment"
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-sm transition-colors hover:bg-accent/50"
            href={run.reviewCommentUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            <MessageSquare className="size-3.5 text-muted-foreground" />
            Review comment
          </a>
        ) : null}
        {run.linearIssueUrl ? (
          <a
            aria-label="Open the linked Linear issue"
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-sm transition-colors hover:bg-accent/50"
            href={run.linearIssueUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            <Layers className="size-3.5 text-muted-foreground" />
            {run.linearIssueIdentifier ?? "Linear"}
          </a>
        ) : null}
      </div>

      {/* Policy — chips by default, full jsonb behind details */}
      {policy ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-muted-foreground text-xs uppercase tracking-wide">
              Policy
            </span>
            <PolicyChip label="autoReview" value={policy.autoReview} />
            <PolicyChip label="autoFix" value={policy.autoFix} />
            <PolicyChip label="protectedMode" value={protectedModeEnabled} />
            <PolicyChip
              label="severity"
              value={
                typeof policy.severityThreshold === "string"
                  ? policy.severityThreshold
                  : undefined
              }
            />
            {typeof policy.agreementThreshold === "number" ? (
              <PolicyChip label="agreement" value={policy.agreementThreshold} />
            ) : null}
          </div>
          <details className="group">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-primary text-xs hover:underline">
              <span className="transition-transform group-open:rotate-90">
                ›
              </span>
              Full policy
            </summary>
            <pre className="mt-2 overflow-x-auto rounded-lg border bg-background/60 p-3 font-mono text-[11px] text-muted-foreground leading-relaxed">
              {JSON.stringify(policy, null, 2)}
            </pre>
          </details>
        </div>
      ) : null}
    </div>
  );
}
