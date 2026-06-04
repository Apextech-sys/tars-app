"use client";

import {
  Bot,
  ChevronDown,
  ChevronRight,
  GitMerge,
  Layers,
  MinusCircle,
  PlusCircle,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { SeverityBadge } from "./status-badge";
import type {
  AgreedFinding,
  DebateReviewerPosition,
  DebateTranscript,
  DisagreementPayload,
  FindingItem,
} from "./types";

type Reviewer = "codex" | "claude";

interface NormFinding {
  severity: string;
  location: string;
  title: string;
  body: string;
  suggestion: string | null;
}

function normFromDisagreement(f: FindingItem): NormFinding {
  const file = f.file ?? f.filePath ?? "unknown";
  const line = f.line ?? f.lineNumber;
  const location = line ? `${file}:${line}` : file;
  const title =
    typeof (f as { title?: string }).title === "string"
      ? ((f as { title?: string }).title as string)
      : (f.message ?? f.description ?? "(no title)");
  const body =
    (f as { detail?: string }).detail ?? f.message ?? f.description ?? "";
  return {
    severity: String(f.severity ?? "minor"),
    location,
    title,
    body,
    suggestion: f.suggestion ?? null,
  };
}

function normFromAgreed(f: AgreedFinding): NormFinding {
  const file = f.file ?? "unknown";
  const location = f.line ? `${file}:${f.line}` : file;
  return {
    severity: String(f.severity ?? "minor"),
    location,
    title: f.message ?? "(no title)",
    body: "",
    suggestion: f.suggestion ?? null,
  };
}

function FindingCard({ finding }: { finding: NormFinding }) {
  const [open, setOpen] = useState(false);
  const expandable = Boolean(finding.body || finding.suggestion);
  return (
    <div className="rounded-lg border bg-background/40">
      <button
        aria-expanded={open}
        className="flex min-h-[44px] w-full items-start gap-2 p-3 text-left"
        disabled={!expandable}
        onClick={() => setOpen((o) => !o)}
        type="button"
      >
        {expandable ? (
          <span className="mt-0.5 shrink-0 text-muted-foreground">
            {open ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </span>
        ) : (
          <span className="mt-0.5 size-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 space-y-1.5">
          <span className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={finding.severity} />
            <code className="break-all font-mono text-[11px] text-muted-foreground">
              {finding.location}
            </code>
          </span>
          <span className="block text-foreground/90 text-sm leading-snug">
            {finding.title}
          </span>
        </span>
      </button>
      {open && expandable ? (
        <div className="space-y-2 border-t px-3 pt-2 pb-3">
          {finding.body ? (
            <p className="whitespace-pre-wrap text-muted-foreground text-xs leading-relaxed">
              {finding.body}
            </p>
          ) : null}
          {finding.suggestion ? (
            <div>
              <p className="mb-0.5 font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
                Suggested fix
              </p>
              <p className="whitespace-pre-wrap text-foreground/80 text-xs leading-relaxed">
                {finding.suggestion}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const REVIEWER_META: Record<
  Reviewer,
  { label: string; icon: typeof Bot; accent: string }
> = {
  codex: { label: "Codex", icon: Bot, accent: "text-sky-400" },
  claude: { label: "Claude", icon: Sparkles, accent: "text-[#00d4a0]" },
};

function ReviewerColumn({
  reviewer,
  model,
  summary,
  findings,
  delta,
}: {
  reviewer: Reviewer;
  model?: string;
  summary?: string;
  findings: NormFinding[];
  delta?: { endorsed?: number; retracted?: number };
}) {
  const [summaryOpen, setSummaryOpen] = useState(false);
  const meta = REVIEWER_META[reviewer];
  const Icon = meta.icon;
  return (
    <div className="flex h-full flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2">
        <Icon className={cn("size-4", meta.accent)} />
        <h3 className="font-semibold text-sm">{meta.label}</h3>
        <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs tabular-nums">
          {findings.length} finding{findings.length === 1 ? "" : "s"}
        </span>
      </div>
      {model ? (
        <p className="-mt-1 font-mono text-[11px] text-muted-foreground">
          {model}
        </p>
      ) : null}
      {delta &&
      (typeof delta.endorsed === "number" ||
        typeof delta.retracted === "number") ? (
        <div className="flex flex-wrap gap-3 text-xs">
          {delta.endorsed ? (
            <span className="inline-flex items-center gap-1 text-[#00d4a0]">
              <PlusCircle className="size-3" /> {delta.endorsed} endorsed
            </span>
          ) : null}
          {delta.retracted ? (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <MinusCircle className="size-3" /> {delta.retracted} retracted
            </span>
          ) : null}
        </div>
      ) : null}
      {summary ? (
        <div>
          <button
            aria-expanded={summaryOpen}
            className="inline-flex items-center gap-1 text-primary text-xs hover:underline"
            onClick={() => setSummaryOpen((o) => !o)}
            type="button"
          >
            {summaryOpen ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
            Reviewer summary
          </button>
          {summaryOpen ? (
            <p className="mt-2 rounded-lg bg-muted/50 p-3 text-muted-foreground text-xs leading-relaxed">
              {summary}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="flex-1 space-y-2">
        {findings.length === 0 ? (
          <p className="py-2 text-muted-foreground text-xs italic">
            No findings.
          </p>
        ) : (
          findings.map((f, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: list items can legitimately repeat (same location/title); composite key includes index to guarantee React key uniqueness
            <FindingCard finding={f} key={`${reviewer}-${f.location}-${i}`} />
          ))
        )}
      </div>
    </div>
  );
}

function OverlapMeter({
  overlapPct,
  agreed,
  disputed,
}: {
  overlapPct: number | null;
  agreed: number;
  disputed: number;
}) {
  const pct = overlapPct ?? 0;
  let toneCls = "bg-[#00d4a0]";
  if (pct < 40) {
    toneCls = "bg-red-500";
  } else if (pct < 70) {
    toneCls = "bg-amber-500";
  }
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2">
        <GitMerge className="size-4 text-muted-foreground" />
        <span className="font-medium text-sm">Reviewer agreement</span>
        {overlapPct === null ? null : (
          <span className="ml-auto font-mono font-semibold text-foreground text-sm tabular-nums">
            {overlapPct}%
          </span>
        )}
      </div>
      {overlapPct === null ? (
        <p className="mt-2 text-muted-foreground text-xs">
          Overlap ratio not recorded for this run.
        </p>
      ) : (
        <div
          aria-label={`Reviewer overlap ${overlapPct}%`}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={overlapPct}
          className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
          role="progressbar"
        >
          <div
            className={cn("h-full rounded-full transition-all", toneCls)}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2 text-center">
        <div className="rounded-lg border bg-background/40 p-2">
          <div className="font-semibold text-[#00d4a0] text-lg tabular-nums">
            {agreed}
          </div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
            Agreed
          </div>
        </div>
        <div className="rounded-lg border bg-background/40 p-2">
          <div className="font-semibold text-amber-400 text-lg tabular-nums">
            {disputed}
          </div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
            Disputed
          </div>
        </div>
      </div>
    </div>
  );
}

function positionDelta(p: DebateReviewerPosition): {
  endorsed?: number;
  retracted?: number;
} {
  return { endorsed: p.endorsed, retracted: p.retracted };
}

interface ReviewerCompareProps {
  payload: DisagreementPayload | null;
  debate: DebateTranscript | null;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: a single presentational comparison surface that intentionally folds the final-positions view, the per-round stepper, and the agreement meter into one component to keep the two reviewers visually paired.
export function ReviewerCompare({ payload, debate }: ReviewerCompareProps) {
  const rounds = debate?.rounds ?? [];
  const hasRounds = rounds.length > 0;
  const [view, setView] = useState<"final" | "rounds">("final");
  const [roundIdx, setRoundIdx] = useState(
    rounds.length > 0 ? rounds.length - 1 : 0
  );

  const overlapPct =
    payload?.overlapRatio === undefined || payload?.overlapRatio === null
      ? null
      : Math.round(payload.overlapRatio * 100);
  const agreedCount = debate?.agreed?.length ?? 0;
  const disputedCount = debate?.disputed?.length ?? 0;

  // Final positions: prefer the disagreedPayload (full title/detail); fall back
  // to the last debate round's findings when there is no disagreement payload.
  const lastRound = rounds.at(-1);
  const codexFinal: NormFinding[] = payload?.codex?.findings
    ? payload.codex.findings.map(normFromDisagreement)
    : (lastRound?.codex.findings ?? []).map(normFromAgreed);
  const claudeFinal: NormFinding[] = payload?.claude?.findings
    ? payload.claude.findings.map(normFromDisagreement)
    : (lastRound?.claude.findings ?? []).map(normFromAgreed);

  const activeRound = rounds[roundIdx];
  const codexRound = (activeRound?.codex.findings ?? []).map(normFromAgreed);
  const claudeRound = (activeRound?.claude.findings ?? []).map(normFromAgreed);

  const showRounds = view === "rounds" && hasRounds;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {hasRounds ? (
          <div className="inline-flex rounded-lg border bg-card p-0.5">
            <button
              className={cn(
                "rounded-md px-3 py-1.5 text-xs transition-colors",
                view === "final"
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setView("final")}
              type="button"
            >
              Final positions
            </button>
            <button
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs transition-colors",
                view === "rounds"
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => setView("rounds")}
              type="button"
            >
              <Layers className="size-3" /> Per-round debate
            </button>
          </div>
        ) : null}
        {debate?.stopReason ? (
          <span className="ml-auto font-mono text-[11px] text-muted-foreground">
            stop: {debate.stopReason}
          </span>
        ) : null}
      </div>

      {showRounds ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {rounds.map((r, i) => (
              <button
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-xs transition-colors",
                  i === roundIdx
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "bg-card text-muted-foreground hover:text-foreground"
                )}
                key={`round-tab-${r.round}`}
                onClick={() => setRoundIdx(i)}
                type="button"
              >
                Round {r.round}
              </button>
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <ReviewerColumn
              delta={activeRound ? positionDelta(activeRound.codex) : undefined}
              findings={codexRound}
              reviewer="codex"
              summary={activeRound?.codex.summary}
            />
            <ReviewerColumn
              delta={
                activeRound ? positionDelta(activeRound.claude) : undefined
              }
              findings={claudeRound}
              reviewer="claude"
              summary={activeRound?.claude.summary}
            />
          </div>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_minmax(180px,220px)_1fr]">
          <ReviewerColumn
            findings={codexFinal}
            model={payload?.codex?.model}
            reviewer="codex"
            summary={payload?.codex?.summary}
          />
          <OverlapMeter
            agreed={agreedCount}
            disputed={disputedCount}
            overlapPct={overlapPct}
          />
          <ReviewerColumn
            findings={claudeFinal}
            model={payload?.claude?.model}
            reviewer="claude"
            summary={payload?.claude?.summary}
          />
        </div>
      )}
    </div>
  );
}
