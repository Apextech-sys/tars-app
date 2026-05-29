"use client";

import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  MessagesSquare,
  MinusCircle,
  PlusCircle,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { SeverityBadge } from "./status-badge";
import type {
  AgreedFinding,
  DebateReviewerPosition,
  DebateTranscript,
} from "./types";

const STOP_REASON_COPY: Record<
  DebateTranscript["stopReason"],
  { label: string; cls: string }
> = {
  converged: {
    label: "Converged — both reviewers reached the same set",
    cls: "text-emerald-400",
  },
  "max-rounds": {
    label: "Stopped at max rounds — some findings stayed disputed",
    cls: "text-amber-400",
  },
  "no-findings": {
    label: "No findings — the PR was clean",
    cls: "text-zinc-400",
  },
};

function FindingRow({ f }: { f: AgreedFinding }) {
  const loc = f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : "(no file)";
  return (
    <div className="rounded-md border border-border bg-card/50 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {f.severity && <SeverityBadge severity={f.severity} />}
        <code className="break-all font-mono text-muted-foreground text-xs">
          {loc}
        </code>
      </div>
      {f.message && (
        <p className="mt-1 text-foreground/90 text-xs leading-relaxed">
          {f.message}
        </p>
      )}
    </div>
  );
}

function ReviewerColumn({
  position,
  showDelta,
}: {
  position: DebateReviewerPosition;
  showDelta: boolean;
}) {
  const title = position.reviewer === "codex" ? "Codex" : "Claude";
  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-semibold text-sm">{title}</h4>
        <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs">
          {position.findings.length} flagged
        </span>
      </div>
      {showDelta &&
        (typeof position.endorsed === "number" ||
          typeof position.retracted === "number") && (
          <div className="flex flex-wrap gap-2 text-xs">
            {!!position.endorsed && (
              <span className="inline-flex items-center gap-1 text-emerald-400">
                <PlusCircle className="size-3" /> {position.endorsed} endorsed
              </span>
            )}
            {!!position.retracted && (
              <span className="inline-flex items-center gap-1 text-zinc-400">
                <MinusCircle className="size-3" /> {position.retracted} retracted
              </span>
            )}
          </div>
        )}
      {position.findings.length === 0 ? (
        <p className="py-1 text-muted-foreground text-xs italic">
          No findings this round.
        </p>
      ) : (
        <div className="space-y-1.5">
          {position.findings.map((f, i) => (
            <FindingRow
              f={f}
              key={`${position.reviewer}-${f.file ?? "x"}-${f.line ?? i}-${(
                f.message ?? ""
              ).slice(0, 16)}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RoundBlock({
  round,
  codex,
  claude,
  defaultOpen,
}: {
  round: number;
  codex: DebateReviewerPosition;
  claude: DebateReviewerPosition;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      className="rounded-lg border border-border bg-card/30"
      data-testid={`debate-round-${round}`}
    >
      <button
        aria-expanded={open}
        className="flex min-h-[44px] w-full items-center gap-2 px-3 py-2.5 text-left"
        data-testid={`debate-round-toggle-${round}`}
        onClick={() => setOpen((o) => !o)}
        type="button"
      >
        {open ? (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="font-medium text-sm">
          Round {round}
          {round === 1 ? " — independent review" : " — exchange"}
        </span>
        <span className="ml-auto text-muted-foreground text-xs">
          {codex.findings.length} / {claude.findings.length}
        </span>
      </button>
      {open && (
        <div
          className="grid gap-3 border-border border-t p-3 sm:grid-cols-2"
          data-testid={`debate-round-body-${round}`}
        >
          <ReviewerColumn position={codex} showDelta={round > 1} />
          <ReviewerColumn position={claude} showDelta={round > 1} />
        </div>
      )}
    </div>
  );
}

function ConvergenceCard({
  title,
  icon: Icon,
  iconCls,
  findings,
  emptyCopy,
}: {
  title: string;
  icon: typeof ShieldCheck;
  iconCls: string;
  findings: AgreedFinding[];
  emptyCopy: string;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <Icon className={cn("size-4", iconCls)} />
        <h4 className="font-semibold text-sm">{title}</h4>
        <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs">
          {findings.length}
        </span>
      </div>
      {findings.length === 0 ? (
        <p className="text-muted-foreground text-xs italic">{emptyCopy}</p>
      ) : (
        <div className="space-y-1.5">
          {findings.map((f, i) => (
            <FindingRow
              f={f}
              key={`${title}-${f.file ?? "x"}-${f.line ?? i}-${(
                f.message ?? ""
              ).slice(0, 16)}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function DebatePanel({ debate }: { debate: DebateTranscript }) {
  const stop = STOP_REASON_COPY[debate.stopReason] ?? {
    label: debate.stopReason,
    cls: "text-muted-foreground",
  };
  const rounds = debate.rounds ?? [];

  return (
    <div className="space-y-4" data-testid="debate-panel">
      {/* Summary banner */}
      <div className="flex items-start gap-2 rounded-lg border border-violet-500/30 bg-violet-500/5 p-4">
        <MessagesSquare className="mt-0.5 size-4 shrink-0 text-violet-400" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium text-sm">
            {rounds.length} debate round{rounds.length === 1 ? "" : "s"}
            <span className="ml-1 font-normal text-muted-foreground">
              (max {debate.maxRounds})
            </span>
          </p>
          <p className={cn("text-xs leading-relaxed", stop.cls)}>{stop.label}</p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Codex and Claude review independently, then exchange findings each
            round — endorsing what they now agree is real and retracting what
            they don&apos;t. A finding is agreed once both endorse it.
          </p>
        </div>
      </div>

      {/* Per-round exchange */}
      {rounds.length > 0 && (
        <div className="space-y-2">
          {rounds.map((r) => (
            <RoundBlock
              claude={r.claude}
              codex={r.codex}
              defaultOpen={r.round === rounds.length}
              key={`round-${r.round}`}
              round={r.round}
            />
          ))}
        </div>
      )}

      {/* Convergence outcome */}
      <div className="grid gap-3 sm:grid-cols-2">
        <ConvergenceCard
          emptyCopy="Nothing both reviewers endorsed."
          findings={debate.agreed ?? []}
          icon={CheckCircle2}
          iconCls="text-emerald-400"
          title="Converged — agreed"
        />
        <ConvergenceCard
          emptyCopy="No findings stayed disputed."
          findings={debate.disputed ?? []}
          icon={ShieldCheck}
          iconCls="text-amber-400"
          title="Still disputed"
        />
      </div>
    </div>
  );
}
