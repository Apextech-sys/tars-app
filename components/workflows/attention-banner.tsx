import { AlertTriangle, Scale, ShieldQuestion } from "lucide-react";
import Link from "next/link";
import type { AttentionRun } from "@/lib/tars/workflows";
import { cn } from "@/lib/utils";
import { ageFromMs } from "./shared";

type Tone = "bad" | "warn" | "purple";

const TONE_CLS: Record<Tone, { border: string; text: string; chip: string }> = {
  bad: {
    border: "border-red-500/40 bg-red-500/10",
    text: "text-red-300",
    chip: "border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20",
  },
  warn: {
    border: "border-amber-500/40 bg-amber-500/10",
    text: "text-amber-300",
    chip: "border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20",
  },
  purple: {
    border: "border-purple-500/40 bg-purple-500/10",
    text: "text-purple-300",
    chip: "border-purple-500/30 bg-purple-500/10 text-purple-200 hover:bg-purple-500/20",
  },
};

function Banner({
  tone,
  icon: Icon,
  headline,
  detail,
  runs,
}: {
  tone: Tone;
  icon: typeof AlertTriangle;
  headline: string;
  detail: string;
  runs: AttentionRun[];
}) {
  const t = TONE_CLS[tone];
  return (
    <details className={cn("group rounded-xl border px-4 py-3", t.border)}>
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm">
        <Icon className={cn("size-4 shrink-0", t.text)} />
        <span className={cn("font-medium", t.text)}>{headline}</span>
        <span className="text-muted-foreground">· {detail}</span>
        <span className="ml-auto text-muted-foreground text-xs group-open:hidden">
          show
        </span>
        <span className="ml-auto hidden text-muted-foreground text-xs group-open:inline">
          hide
        </span>
      </summary>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {runs.slice(0, 12).map((r) => (
          <Link
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition-colors",
              t.chip
            )}
            href={`/workflows/run/${r.runId}`}
            key={r.runId}
          >
            <span className="font-mono">
              {r.repo} #{r.prNumber}
            </span>
            <span className="tabular-nums opacity-70">
              {ageFromMs(r.ageMs)}
            </span>
          </Link>
        ))}
        {runs.length > 12 ? (
          <span className="px-2 py-1 text-muted-foreground text-xs">
            +{runs.length - 12} more
          </span>
        ) : null}
      </div>
    </details>
  );
}

export function AttentionBanner({
  stalled,
  pendingApproval,
  disagreed,
}: {
  stalled: AttentionRun[];
  pendingApproval: AttentionRun[];
  disagreed: AttentionRun[];
}) {
  if (
    stalled.length === 0 &&
    pendingApproval.length === 0 &&
    disagreed.length === 0
  ) {
    return null;
  }
  const oldestStallH = stalled.length > 0 ? ageFromMs(stalled[0].ageMs) : null;

  return (
    <div className="space-y-2">
      {stalled.length > 0 ? (
        <Banner
          detail={`oldest stuck ${oldestStallH} — durable run is not progressing`}
          headline={`${stalled.length} stalled run${stalled.length === 1 ? "" : "s"}`}
          icon={AlertTriangle}
          runs={stalled}
          tone="bad"
        />
      ) : null}
      {pendingApproval.length > 0 ? (
        <Banner
          detail="dual-AI reviews agreed on findings, awaiting your decision"
          headline={`${pendingApproval.length} awaiting approval`}
          icon={ShieldQuestion}
          runs={pendingApproval}
          tone="warn"
        />
      ) : null}
      {disagreed.length > 0 ? (
        <Banner
          detail="Codex and Claude diverged, awaiting adjudication"
          headline={`${disagreed.length} reviewer disagreement${disagreed.length === 1 ? "" : "s"}`}
          icon={Scale}
          runs={disagreed}
          tone="purple"
        />
      ) : null}
    </div>
  );
}
