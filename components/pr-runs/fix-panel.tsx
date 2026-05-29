"use client";

import {
  CheckCircle2,
  ExternalLink,
  FlaskConical,
  GitBranch,
  Loader2,
  Radar,
  ShieldX,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { SeverityBadge } from "./status-badge";
import type { FixBlastRadius, FixRevalidationItem } from "./types";

interface FixPanelProps {
  runId: string;
  status: string;
  fixStatus: string | null;
  fixBranch: string | null;
  fixPrUrl: string | null;
  fixPrNumber: number | null;
  fixRevalidation: FixRevalidationItem[] | null;
  fixBlastRadius: FixBlastRadius | null;
  fixCoverageRootcause: string | null;
  error: string | null;
}

type Phase = "fixing" | "in-review" | "failed";

function toPhase(status: string): Phase {
  if (status === "fix-in-review" || status === "done") {
    return "in-review";
  }
  if (status === "fix-failed") {
    return "failed";
  }
  return "fixing";
}

const BANNER: Record<Phase, { title: string; body: string; cls: string }> = {
  fixing: {
    title: "Claude Code is fixing",
    body: "Re-validating the approved findings against the real code, tracing the blast radius of the fix, applying it within radius, then testing + expanding the suite. This page live-updates.",
    cls: "border-indigo-500/30 bg-indigo-500/5",
  },
  "in-review": {
    title: "Fix PR opened — awaiting human review",
    body: "The fix is committed to a dedicated branch and a PR is open against the original base. TARS never merges its own fixes; you review and merge. On merge the Linear issue moves to Done.",
    cls: "border-cyan-500/30 bg-cyan-500/5",
  },
  failed: {
    title: "Fix stage failed",
    body: "The fix could not be safely completed. Nothing was merged and no protected branch was touched. See the reason below.",
    cls: "border-red-500/30 bg-red-500/5",
  },
};

function BannerIcon({ phase }: { phase: Phase }) {
  if (phase === "fixing") {
    return (
      <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-indigo-400" />
    );
  }
  if (phase === "in-review") {
    return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-cyan-400" />;
  }
  return <ShieldX className="mt-0.5 size-4 shrink-0 text-red-400" />;
}

function RevalRow({ item }: { item: FixRevalidationItem }) {
  const f = item.finding;
  const file = f?.file ?? "unknown";
  const line = f?.line ? `:${f.line}` : "";
  return (
    <div className="rounded-md border border-border bg-card/50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        {item.kept ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-medium text-emerald-400 text-xs">
            <CheckCircle2 className="size-3" /> kept
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-zinc-500/30 bg-zinc-500/10 px-2 py-0.5 font-medium text-xs text-zinc-400">
            <XCircle className="size-3" /> dropped
          </span>
        )}
        {f?.severity && <SeverityBadge severity={f.severity} />}
        <code className="break-all font-mono text-muted-foreground text-xs">
          {file}
          {line}
        </code>
      </div>
      {f?.message && (
        <p className="mt-1.5 text-foreground/90 text-sm leading-relaxed">
          {f.message}
        </p>
      )}
      <p className="mt-1 text-muted-foreground text-xs italic leading-relaxed">
        {item.reason}
      </p>
    </div>
  );
}

function blastKey(s: string): string {
  return s;
}

export function FixPanel(props: FixPanelProps) {
  const router = useRouter();
  const phase = toPhase(props.status);

  // Live-update while the fix is in flight. The detail page is server-rendered
  // with force-dynamic, so router.refresh() re-fetches the run server-side.
  const [polling, setPolling] = useState(props.status === "fixing");
  useEffect(() => {
    setPolling(props.status === "fixing");
  }, [props.status]);
  useEffect(() => {
    if (!polling) {
      return;
    }
    const id = setInterval(() => router.refresh(), 8000);
    return () => clearInterval(id);
  }, [polling, router]);

  const banner = BANNER[phase];
  const reval = props.fixRevalidation ?? [];
  const keptCount = reval.filter((r) => r.kept).length;
  const blast = props.fixBlastRadius;

  return (
    <div className="space-y-4">
      <div
        className={cn(
          "flex items-start gap-2 rounded-lg border p-4",
          banner.cls
        )}
      >
        <BannerIcon phase={phase} />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium text-sm">{banner.title}</p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            {banner.body}
          </p>
          {props.fixStatus && (
            <p className="mt-1 font-mono text-muted-foreground/70 text-xs">
              stage: {props.fixStatus}
            </p>
          )}
        </div>
      </div>

      {/* Fix PR link */}
      {props.fixPrUrl && (
        <a
          aria-label="Open the fix pull request"
          className="inline-flex min-h-[44px] w-full items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/5 px-3 py-2 text-sm transition-colors hover:bg-cyan-500/10 sm:w-auto"
          href={props.fixPrUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          <GitBranch className="size-4 text-cyan-400" />
          <span className="font-medium">
            Fix PR{props.fixPrNumber ? ` #${props.fixPrNumber}` : ""}
          </span>
          {props.fixBranch && (
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground text-xs">
              {props.fixBranch}
            </code>
          )}
          <ExternalLink className="ml-auto size-3.5 text-muted-foreground" />
        </a>
      )}

      {/* Failure reason */}
      {phase === "failed" && props.error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
          <p className="mb-1 font-medium text-red-400 text-sm">Reason</p>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words text-muted-foreground text-xs leading-relaxed">
            {props.error}
          </pre>
        </div>
      )}

      {/* Stage 7 — re-validation */}
      {reval.length > 0 && (
        <div className="space-y-2 rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldX className="size-4 text-muted-foreground" />
              <h3 className="font-semibold text-sm">
                Re-validation (independent re-check)
              </h3>
            </div>
            <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs">
              {keptCount}/{reval.length} kept
            </span>
          </div>
          <div className="space-y-2">
            {reval.map((r) => (
              <RevalRow
                item={r}
                key={`reval-${r.finding?.file ?? "x"}-${r.finding?.line ?? "n"}-${(
                  r.reason ?? ""
                ).slice(0, 24)}`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Stage 8 — blast radius of the fix */}
      <BlastRadiusCard blast={blast} />

      {/* Stage 10c — coverage-gap root cause */}
      <CoverageCard rootCause={props.fixCoverageRootcause} />
    </div>
  );
}

function PathList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <div>
      <p className="mb-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {title}
      </p>
      <ul className="space-y-1">
        {items.map((item) => (
          <li
            className="break-all font-mono text-foreground/80 text-xs"
            key={blastKey(item)}
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function BlastRadiusCard({ blast }: { blast: FixBlastRadius | null }) {
  const changedFiles = blast?.changedFiles ?? [];
  const callers = (blast?.callers ?? []).slice(0, 25);
  if (!(blast && (blast.summary || changedFiles.length > 0))) {
    return null;
  }
  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <Radar className="size-4 text-muted-foreground" />
        <h3 className="font-semibold text-sm">Blast radius of the fix</h3>
      </div>
      {blast.summary && (
        <p className="text-foreground/90 text-sm leading-relaxed">
          {blast.summary}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <PathList items={changedFiles} title="Changed files" />
        <PathList items={callers} title="Callers in radius" />
      </div>
      {blast.notes && (
        <p className="text-muted-foreground text-xs italic">{blast.notes}</p>
      )}
    </div>
  );
}

function CoverageCard({ rootCause }: { rootCause: string | null }) {
  if (!rootCause) {
    return null;
  }
  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <FlaskConical className="size-4 text-muted-foreground" />
        <h3 className="font-semibold text-sm">Coverage-gap root cause</h3>
      </div>
      <p className="text-foreground/90 text-sm leading-relaxed">{rootCause}</p>
      <p className="text-muted-foreground text-xs">
        Why the existing suite missed this — the fix PR adds regression coverage
        so it can't recur silently.
      </p>
    </div>
  );
}
