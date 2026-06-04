import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Download,
  FileCode2,
  Flag,
  GitMerge,
  type LucideIcon,
  MessagesSquare,
  PlayCircle,
  Radar,
  Route,
  ShieldCheck,
  Ticket,
} from "lucide-react";

export type BadgeVariant =
  | "default"
  | "success"
  | "destructive"
  | "secondary"
  | "warning";

/**
 * Real statuses in audit_log are: ok | start | skip | info | error.
 * `start` = an in-progress marker (a step that opened but whose `ok`/`error`
 * row comes later); render it subtly. Legacy done/success/failed/warn kept.
 */
export function statusVariant(status: string): BadgeVariant {
  if (status === "ok" || status === "done" || status === "success") {
    return "success";
  }
  if (status === "error" || status === "failed" || status === "fix-failed") {
    return "destructive";
  }
  if (status === "skip" || status === "skipped") {
    return "secondary";
  }
  if (status === "warn" || status === "warning") {
    return "warning";
  }
  // start | info
  return "default";
}

/** Dot color for the timeline node, mirroring statusVariant. */
export function statusDot(status: string): string {
  const v = statusVariant(status);
  if (v === "success") {
    return "bg-[#00d4a0]";
  }
  if (v === "destructive") {
    return "bg-red-500";
  }
  if (v === "warning") {
    return "bg-amber-500";
  }
  if (v === "secondary") {
    return "bg-muted-foreground/40";
  }
  if (status === "start") {
    return "bg-sky-400";
  }
  return "bg-muted-foreground/60";
}

const STEP_ICONS: Record<string, LucideIcon> = {
  start: PlayCircle,
  routing: Route,
  "fetch-pr": Download,
  "claude-review": FileCode2,
  "codex-review": FileCode2,
  debate: MessagesSquare,
  "debate-round": MessagesSquare,
  triage: Flag,
  "blast-radius": Radar,
  "approval-gate": ShieldCheck,
  "linear-issue": Ticket,
  "disagree-route": GitMerge,
  complete: CheckCircle2,
  error: AlertTriangle,
};

export function stepIcon(step: string): LucideIcon {
  return STEP_ICONS[step] ?? CircleDot;
}

const STEP_LABELS: Record<string, string> = {
  start: "Start",
  routing: "Routing",
  "fetch-pr": "Fetch PR",
  "claude-review": "Claude review",
  "codex-review": "Codex review",
  debate: "Debate",
  "debate-round": "Debate round",
  triage: "Triage",
  "blast-radius": "Blast radius",
  "approval-gate": "Approval gate",
  "linear-issue": "Linear issue",
  "disagree-route": "Disagreement route",
  complete: "Complete",
  error: "Error",
};

export function stepLabel(step: string): string {
  return STEP_LABELS[step] ?? step;
}

function asRecord(data: unknown): Record<string, unknown> | null {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return null;
}

function num(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function firstLine(s: string, max = 160): string {
  const line = s.split("\n")[0]?.trim() ?? s;
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: a flat dispatch over 14 known audit step kinds — each branch is a tiny independent formatter, breadth not tangled control flow
export function humanizeStep(
  step: string,
  status: string,
  data: unknown,
  message?: string | null
): string {
  if (message) {
    return firstLine(message);
  }
  const d = asRecord(data);
  if (!d) {
    return status === "start" ? "started" : status;
  }

  if (step === "start") {
    const input = asRecord(d.input);
    const repo = str(input?.repo);
    const pr = num(input?.prNumber);
    if (repo && pr !== null) {
      return `dispatched · ${repo} #${pr}`;
    }
    return "dispatched";
  }
  if (step === "routing") {
    const policy = asRecord(d.policy);
    const autoReview = policy?.autoReview === true ? "auto-review" : "manual";
    const threshold = str(policy?.severityThreshold) ?? "minor";
    const autoFix = policy?.autoFix === true ? " · auto-fix" : "";
    return `${autoReview}, severity ≥ ${threshold}${autoFix}`;
  }
  if (step === "fetch-pr") {
    const add = num(d.additions);
    const del = num(d.deletions);
    const files = num(d.changedFiles);
    if (files !== null) {
      return `${files} file${files === 1 ? "" : "s"} · +${add ?? 0} −${del ?? 0}`;
    }
    return "fetched diff";
  }
  if (step === "claude-review" || step === "codex-review") {
    const round = num(d.round);
    const st = str(d.status) ?? status;
    const attempts = num(d.attempts);
    const roundTxt = round === null ? "" : `round ${round}, `;
    const attemptTxt =
      attempts && attempts > 1 ? ` (${attempts} attempts)` : "";
    if (st === "failed") {
      const err = str(d.errorText);
      return `${roundTxt}failed${attemptTxt}${err ? ` — ${firstLine(err, 90)}` : ""}`;
    }
    return `${roundTxt}${st}${attemptTxt}`;
  }
  if (step === "debate") {
    const agreed = num(d.agreed) ?? 0;
    const disputed = num(d.disputed) ?? 0;
    const rounds = num(d.rounds);
    const stop = str(d.stopReason);
    const overlap = num(d.overlapRatio);
    const overlapTxt =
      overlap === null ? "" : `, overlap ${(overlap * 100).toFixed(0)}%`;
    const roundTxt =
      rounds === null ? "" : ` over ${rounds} round${rounds === 1 ? "" : "s"}`;
    return `${agreed} agreed / ${disputed} disputed${roundTxt}${stop ? ` · ${stop}` : ""}${overlapTxt}`;
  }
  if (step === "debate-round") {
    const round = num(d.round);
    const codex = num(d.codex) ?? 0;
    const claude = num(d.claude) ?? 0;
    const agreed = num(d.agreed) ?? 0;
    return `round ${round ?? "?"} · codex ${codex} vs claude ${claude}, ${agreed} agreed`;
  }
  if (step === "triage") {
    const agreed = num(d.agreed) ?? 0;
    const after = num(d.afterSeverityFilter);
    const threshold = str(d.threshold);
    const filterTxt =
      after === null ? "" : `, ${after} above ${threshold ?? "threshold"}`;
    return `${agreed} agreed finding${agreed === 1 ? "" : "s"}${filterTxt}`;
  }
  if (step === "blast-radius") {
    const files = num(d.files) ?? 0;
    const callers = num(d.callers);
    const available = d.available;
    if (available === 0 || available === false) {
      return "blast radius unavailable";
    }
    return `${files} file${files === 1 ? "" : "s"}${callers === null ? "" : ` · ${callers} caller${callers === 1 ? "" : "s"}`}`;
  }
  if (step === "approval-gate") {
    const n = num(d.findingsCount) ?? 0;
    return `${n} finding${n === 1 ? "" : "s"} awaiting decision`;
  }
  if (step === "linear-issue") {
    const reason = str(d.reason);
    if (reason) {
      return reason;
    }
    const id = str(d.identifier);
    return id ? `issue ${id}` : "linear issue";
  }
  if (step === "disagree-route") {
    const codex = num(d.codexCount) ?? 0;
    const claude = num(d.claudeCount) ?? 0;
    const disputed = num(d.disputed) ?? 0;
    return `routed to adjudication · ${disputed} disputed (codex ${codex} / claude ${claude})`;
  }
  if (step === "complete") {
    const st = str(d.status);
    const n = num(d.findingsCount) ?? 0;
    return `${st ?? "done"} · ${n} finding${n === 1 ? "" : "s"}`;
  }
  if (step === "error") {
    const msg = str(d.message) ?? str(d.errorText);
    return msg ? firstLine(msg, 180) : "error";
  }
  return status;
}
