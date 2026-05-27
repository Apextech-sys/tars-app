import {
  Clock,
  ExternalLink,
  GitPullRequest,
  MessageSquare,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { RunStatusBadge } from "./status-badge";
import type { PolicyConfig, PrRun } from "./types";

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) {
    return `${s}s`;
  }
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) {
    return `${m}m ${rem}s`;
  }
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function PolicyChip({
  label,
  value,
}: {
  label: string;
  value: boolean | string | number | undefined | null;
}) {
  const isActive =
    value === true || (typeof value === "string" && value !== "false");
  const displayValue = typeof value === "number" ? `${label}: ${value}` : label;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 font-medium text-xs",
        isActive
          ? "border-primary/30 bg-primary/10 text-primary"
          : "border-zinc-700 bg-zinc-800/50 text-zinc-500"
      )}
    >
      {displayValue}
      {typeof value !== "number" && (
        <span className="ml-1 text-[10px] opacity-70">
          {isActive ? "on" : "off"}
        </span>
      )}
    </span>
  );
}

export function RunHeader({
  run,
  prTitle,
}: {
  run: PrRun;
  prTitle?: string | null;
}) {
  const policy = run.policy as PolicyConfig | null;
  const ghUrl = `https://github.com/${run.owner}/${run.repo}/pull/${run.prNumber}`;

  const elapsed = formatDuration(
    new Date(run.updatedAt).getTime() - new Date(run.createdAt).getTime()
  );

  const protectedModeEnabled =
    policy?.protectedMode === true ||
    (typeof policy?.protectedMode === "object" &&
      policy.protectedMode?.enabled);

  return (
    <div className="space-y-4">
      {/* Title row */}
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <GitPullRequest className="size-5 shrink-0 text-muted-foreground" />
            <h1 className="font-semibold text-xl leading-tight">
              {prTitle ?? `PR #${run.prNumber}`}
            </h1>
          </div>
          <p className="mt-1 font-mono text-muted-foreground text-sm">
            {run.owner}/{run.repo}
            <span className="text-foreground/60"> #</span>
            {run.prNumber}
          </p>
        </div>
        <RunStatusBadge status={run.status} />
      </div>

      {/* Meta grid */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {run.prSha && (
          <div className="space-y-0.5">
            <p className="text-muted-foreground text-xs uppercase tracking-wide">
              Head SHA
            </p>
            <p className="w-fit rounded bg-muted px-2 py-1 font-mono text-sm">
              {run.prSha.slice(0, 7)}
            </p>
          </div>
        )}
        <div className="space-y-0.5">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">
            Duration
          </p>
          <div className="flex items-center gap-1.5 text-sm">
            <Clock className="size-3.5 text-muted-foreground" />
            {elapsed}
          </div>
        </div>
        <div className="space-y-0.5">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">
            Created
          </p>
          <p className="text-sm">{new Date(run.createdAt).toLocaleString()}</p>
        </div>
        <div className="space-y-0.5">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">
            Updated
          </p>
          <p className="text-sm">{new Date(run.updatedAt).toLocaleString()}</p>
        </div>
      </div>

      {/* Links */}
      <div className="flex flex-wrap gap-2">
        <Link
          aria-label={`Open PR #${run.prNumber} on GitHub`}
          className="inline-flex items-center gap-1.5 text-primary text-sm hover:underline"
          href={ghUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          <ExternalLink className="size-3.5" />
          View on GitHub
        </Link>
        {run.reviewCommentUrl && (
          <Link
            aria-label="View posted review comment"
            className="inline-flex items-center gap-1.5 text-primary text-sm hover:underline"
            href={run.reviewCommentUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            <MessageSquare className="size-3.5" />
            Review comment
          </Link>
        )}
      </div>

      {/* Policy chips */}
      {policy && (
        <div className="space-y-1.5">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">
            Policy
          </p>
          <div className="flex flex-wrap gap-1.5">
            <PolicyChip label="autoFix" value={policy.autoFix} />
            <PolicyChip label="dryRun" value={policy.dryRun} />
            <PolicyChip label="protectedMode" value={protectedModeEnabled} />
            {policy.agreementThreshold !== undefined && (
              <PolicyChip
                label="agreementThreshold"
                value={policy.agreementThreshold}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
