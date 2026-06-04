"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  CircleSlash,
  Flag,
  GitPullRequest,
  Loader2,
  type LucideIcon,
  MessagesSquare,
  Radar,
  Route,
  ShieldCheck,
  Ticket,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { JsonTree } from "./json-tree";
import type { AuditLogRow } from "./types";

type StageState = "ok" | "running" | "error" | "skipped" | "pending";

interface StageDef {
  key: string;
  label: string;
  icon: LucideIcon;
  steps: string[];
}

// The canonical 9-step pipeline. Raw audit `step` values are grouped into
// these named stages; the debate stage absorbs the per-reviewer chatter.
const STAGES: StageDef[] = [
  {
    key: "routing",
    label: "Routing",
    icon: Route,
    steps: ["start", "routing"],
  },
  {
    key: "fetch",
    label: "Fetch PR",
    icon: GitPullRequest,
    steps: ["fetch-pr"],
  },
  {
    key: "debate",
    label: "Debate",
    icon: MessagesSquare,
    steps: ["debate", "claude-review", "codex-review", "debate-round"],
  },
  { key: "triage", label: "Triage", icon: Flag, steps: ["triage"] },
  {
    key: "blast",
    label: "Blast radius",
    icon: Radar,
    steps: ["blast-radius"],
  },
  {
    key: "gate",
    label: "Approval gate",
    icon: ShieldCheck,
    steps: ["approval-gate", "disagree-route"],
  },
  { key: "issue", label: "Issue", icon: Ticket, steps: ["linear-issue"] },
  {
    key: "complete",
    label: "Complete",
    icon: CheckCircle2,
    steps: ["complete", "error"],
  },
];

const STEP_TO_STAGE = new Map<string, string>();
for (const stage of STAGES) {
  for (const step of stage.steps) {
    STEP_TO_STAGE.set(step, stage.key);
  }
}

interface ComputedStage {
  def: StageDef;
  state: StageState;
  durationMs: number | null;
  rounds: number;
  rows: AuditLogRow[];
}

function rowState(rows: AuditLogRow[]): StageState {
  if (rows.length === 0) {
    return "pending";
  }
  if (rows.some((r) => r.status === "error" || r.status === "failed")) {
    return "error";
  }
  if (
    rows.some((r) => r.status === "skip") &&
    rows.every((r) => r.status === "skip")
  ) {
    return "skipped";
  }
  if (rows.some((r) => r.status === "ok")) {
    return "ok";
  }
  // start/info only → still in flight
  return "running";
}

function spanMs(rows: AuditLogRow[]): number | null {
  if (rows.length === 0) {
    return null;
  }
  const times = rows.map((r) => new Date(r.createdAt).getTime());
  const span = Math.max(...times) - Math.min(...times);
  return span > 0 ? span : null;
}

function fmtDuration(ms: number | null): string {
  if (ms === null) {
    return "—";
  }
  const s = Math.round(ms / 1000);
  if (s < 60) {
    return `${s}s`;
  }
  const m = Math.floor(s / 60);
  if (m < 60) {
    return `${m}m ${s % 60}s`;
  }
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function computeStages(rows: AuditLogRow[]): ComputedStage[] {
  const byStage = new Map<string, AuditLogRow[]>();
  for (const row of rows) {
    const key = STEP_TO_STAGE.get(row.step);
    if (!key) {
      continue;
    }
    const bucket = byStage.get(key) ?? [];
    bucket.push(row);
    byStage.set(key, bucket);
  }
  return STAGES.map((def) => {
    const stageRows = byStage.get(def.key) ?? [];
    const roundRows = stageRows.filter((r) => r.step === "debate-round");
    return {
      def,
      rows: stageRows,
      state: rowState(stageRows),
      durationMs: spanMs(stageRows),
      rounds: roundRows.length,
    };
  });
}

const STATE_DOT: Record<StageState, string> = {
  ok: "border-[#00d4a0]/50 bg-[#00d4a0]/10 text-[#00d4a0]",
  running: "border-blue-500/50 bg-blue-500/10 text-blue-400",
  error: "border-red-500/50 bg-red-500/10 text-red-400",
  skipped: "border-border bg-muted/40 text-muted-foreground",
  pending:
    "border-dashed border-border bg-transparent text-muted-foreground/60",
};

const STATE_CONNECTOR: Record<StageState, string> = {
  ok: "bg-[#00d4a0]/40",
  running: "bg-blue-500/40",
  error: "bg-red-500/40",
  skipped: "bg-border",
  pending: "bg-border/50",
};

function StateGlyph({
  state,
  icon: Icon,
}: {
  state: StageState;
  icon: LucideIcon;
}) {
  if (state === "running") {
    return <Loader2 className="size-4 animate-spin" />;
  }
  if (state === "error") {
    return <AlertTriangle className="size-4" />;
  }
  if (state === "skipped") {
    return <CircleSlash className="size-4" />;
  }
  if (state === "pending") {
    return <CircleDashed className="size-4" />;
  }
  return <Icon className="size-4" />;
}

function rowKey(row: AuditLogRow): string {
  return `${row.id}`;
}

function StageDetail({ stage }: { stage: ComputedStage }) {
  if (stage.rows.length === 0) {
    return (
      <p className="text-muted-foreground text-xs italic">
        This stage did not run for this review.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {stage.rows.map((row) => (
        <div className="space-y-1.5" key={rowKey(row)}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-semibold text-foreground text-xs">
              {row.step}
            </span>
            <span
              className={cn(
                "rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
                STATE_DOT[rowState([row])]
              )}
            >
              {row.status}
            </span>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground tabular-nums">
              {new Date(row.createdAt).toLocaleTimeString()}
            </span>
          </div>
          {row.message ? (
            <p className="text-muted-foreground text-xs leading-relaxed">
              {row.message}
            </p>
          ) : null}
          {row.data !== null && row.data !== undefined ? (
            <JsonTree data={row.data} />
          ) : null}
        </div>
      ))}
    </div>
  );
}

function StageNode({
  stage,
  index,
  total,
  expanded,
  onToggle,
}: {
  stage: ComputedStage;
  index: number;
  total: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isLast = index === total - 1;
  const connector = STATE_CONNECTOR[stage.state];
  const subtitle =
    stage.def.key === "debate" && stage.rounds > 0
      ? `${stage.rounds} round${stage.rounds === 1 ? "" : "s"}`
      : fmtDuration(stage.durationMs);
  return (
    <div className="relative flex min-w-0 flex-col items-center lg:flex-1">
      {/* connector to the next node (desktop horizontal) */}
      {isLast ? null : (
        <span
          aria-hidden="true"
          className={cn(
            "absolute top-5 left-1/2 hidden h-0.5 w-full lg:block",
            connector
          )}
        />
      )}
      <button
        aria-expanded={expanded}
        className={cn(
          "relative z-10 flex size-10 items-center justify-center rounded-xl border transition-colors",
          STATE_DOT[stage.state]
        )}
        onClick={onToggle}
        type="button"
      >
        <StateGlyph icon={stage.def.icon} state={stage.state} />
      </button>
      <div className="mt-2 text-center">
        <div className="font-medium text-foreground text-xs">
          {stage.def.label}
        </div>
        <div className="font-mono text-[10px] text-muted-foreground tabular-nums">
          {subtitle}
        </div>
      </div>
    </div>
  );
}

export function PipelineStepper({ rows }: { rows: AuditLogRow[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const stages = computeStages(rows);
  const ran = stages.filter((s) => s.state !== "pending").length;
  const errored = stages.some((s) => s.state === "error");
  const total = spanMs(rows);

  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-muted-foreground text-sm">
        No pipeline activity recorded for this run.
      </p>
    );
  }

  function toggle(key: string) {
    setOpenKey((cur) => (cur === key ? null : key));
  }

  const openStage = stages.find((s) => s.def.key === openKey) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground text-xs">
        <span>
          <span className="font-semibold text-foreground tabular-nums">
            {ran}
          </span>{" "}
          of {stages.length} stages ran
        </span>
        <span>
          Total{" "}
          <span className="font-mono text-foreground tabular-nums">
            {fmtDuration(total)}
          </span>
        </span>
        {errored ? (
          <span className="inline-flex items-center gap-1 text-red-400">
            <AlertTriangle className="size-3" /> pipeline errored
          </span>
        ) : null}
        <span className="ml-auto hidden sm:inline">
          Tap a stage to inspect its raw steps
        </span>
      </div>

      {/* Desktop horizontal stepper / mobile vertical list */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-0">
        {stages.map((stage, i) => (
          <div className="lg:flex-1" key={stage.def.key}>
            {/* Mobile row layout reuses the node but lays it out inline */}
            <div className="lg:hidden">
              <button
                aria-expanded={openKey === stage.def.key}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors",
                  stage.state === "error" ? "border-red-500/30" : ""
                )}
                onClick={() => toggle(stage.def.key)}
                type="button"
              >
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-lg border",
                    STATE_DOT[stage.state]
                  )}
                >
                  <StateGlyph icon={stage.def.icon} state={stage.state} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-foreground text-sm">
                    {stage.def.label}
                  </span>
                  <span className="block font-mono text-[11px] text-muted-foreground tabular-nums">
                    {stage.def.key === "debate" && stage.rounds > 0
                      ? `${stage.rounds} rounds · ${fmtDuration(stage.durationMs)}`
                      : fmtDuration(stage.durationMs)}
                  </span>
                </span>
                {openKey === stage.def.key ? (
                  <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                )}
              </button>
            </div>
            {/* Desktop node */}
            <div className="hidden lg:block">
              <StageNode
                expanded={openKey === stage.def.key}
                index={i}
                onToggle={() => toggle(stage.def.key)}
                stage={stage}
                total={stages.length}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Expanded stage detail (shared between layouts) */}
      {openStage ? (
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <openStage.def.icon className="size-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">{openStage.def.label}</h3>
            <span className="ml-auto font-mono text-muted-foreground text-xs tabular-nums">
              {fmtDuration(openStage.durationMs)}
            </span>
          </div>
          <StageDetail stage={openStage} />
        </div>
      ) : null}
    </div>
  );
}
