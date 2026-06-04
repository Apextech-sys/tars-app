import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  ExternalLink,
  Flag,
  Play,
  Workflow,
  XCircle,
  Zap,
} from "lucide-react";
import Link from "next/link";
import {
  cloudConsoleUrl,
  getWorkflowDetail,
  type HistoryEvent,
} from "@/lib/tars/graph-temporal";

export const dynamic = "force-dynamic";

const RC_NAMESPACE = "quickstart-reflex-connect-01.d817x";

function statusClass(status: string): string {
  const map: Record<string, string> = {
    RUNNING: "border-sky-500/30 bg-sky-500/10 text-sky-400",
    COMPLETED: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    FAILED: "border-red-500/30 bg-red-500/10 text-red-400",
    TERMINATED: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    TIMED_OUT: "border-orange-500/30 bg-orange-500/10 text-orange-400",
    CANCELED: "border-zinc-600 bg-zinc-800/50 text-zinc-300",
  };
  return map[status] ?? "border-zinc-600 bg-zinc-800/50 text-zinc-300";
}

function fmtTime(iso: string): string {
  if (!iso) {
    return "";
  }
  try {
    return new Date(iso).toISOString().replace("T", " ").slice(0, 23);
  } catch {
    return iso;
  }
}

function durMs(a: string, b: string): number {
  if (!(a && b)) {
    return 0;
  }
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Number.isNaN(ms) || ms < 0 ? 0 : ms;
}
function durStr(ms: number): string {
  if (!ms) {
    return "";
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  if (ms < 3_600_000) {
    return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
  }
  return `${Math.floor(ms / 3_600_000)}h ${Math.round((ms % 3_600_000) / 60_000)}m`;
}

function prettyType(t: string): string {
  return t
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

type UnitKind = "start" | "activity" | "timer" | "signal" | "end" | "other";
interface Unit {
  kind: UnitKind;
  title: string;
  status: string;
  start: string;
  end: string;
  attempt: number;
  detail: unknown;
  failure: string;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: breadth-heavy switch mapping each Temporal history event type to a timeline unit; one case per event keeps the state machine cohesive and splitting it would risk behavior.
function groupEvents(events: HistoryEvent[]): {
  units: Unit[];
  taskCycles: number;
} {
  const bySched = new Map<number, Unit>();
  const byTimer = new Map<string, Unit>();
  const units: Unit[] = [];
  let taskCycles = 0;
  const num = (v: unknown): number => Number(v ?? 0) || 0;

  for (const e of events) {
    const a = (e.attrs ?? {}) as Record<string, unknown>;
    switch (e.type) {
      case "WORKFLOW_EXECUTION_STARTED": {
        const wt = a.workflowType as { name?: string } | undefined;
        units.push({
          kind: "start",
          title: `Workflow started · ${wt?.name ?? ""}`,
          status: "",
          start: e.time,
          end: "",
          attempt: num(a.attempt) || 1,
          detail: { input: a.input },
          failure: "",
        });
        break;
      }
      case "ACTIVITY_TASK_SCHEDULED": {
        const at = a.activityType as { name?: string } | undefined;
        const u: Unit = {
          kind: "activity",
          title: at?.name ?? "activity",
          status: "scheduled",
          start: e.time,
          end: "",
          attempt: 1,
          detail: { input: a.input },
          failure: "",
        };
        bySched.set(e.id, u);
        units.push(u);
        break;
      }
      case "ACTIVITY_TASK_STARTED": {
        const u = bySched.get(num(a.scheduledEventId));
        if (u) {
          u.status = "running";
          u.attempt = num(a.attempt) || 1;
        }
        break;
      }
      case "ACTIVITY_TASK_COMPLETED": {
        const u = bySched.get(num(a.scheduledEventId));
        if (u) {
          u.status = "completed";
          u.end = e.time;
          u.detail = { ...(u.detail as object), result: a.result };
        }
        break;
      }
      case "ACTIVITY_TASK_FAILED":
      case "ACTIVITY_TASK_TIMED_OUT":
      case "ACTIVITY_TASK_CANCELED": {
        const u = bySched.get(num(a.scheduledEventId));
        if (u) {
          u.status = e.type.endsWith("FAILED") ? "failed" : "timedOut";
          u.end = e.time;
          const f = a.failure as { message?: string } | undefined;
          u.failure = e.failure || f?.message || "";
        }
        break;
      }
      case "TIMER_STARTED": {
        const u: Unit = {
          kind: "timer",
          title: `Timer ${String(a.timerId ?? "")}`,
          status: "running",
          start: e.time,
          end: "",
          attempt: 1,
          detail: { startToFireTimeout: a.startToFireTimeout },
          failure: "",
        };
        byTimer.set(String(a.timerId ?? ""), u);
        units.push(u);
        break;
      }
      case "TIMER_FIRED": {
        const u = byTimer.get(String(a.timerId ?? ""));
        if (u) {
          u.status = "fired";
          u.end = e.time;
        }
        break;
      }
      case "WORKFLOW_EXECUTION_SIGNALED": {
        units.push({
          kind: "signal",
          title: `Signal · ${String(a.signalName ?? "")}`,
          status: "",
          start: e.time,
          end: "",
          attempt: 1,
          detail: { input: a.input },
          failure: "",
        });
        break;
      }
      case "WORKFLOW_EXECUTION_COMPLETED": {
        units.push({
          kind: "end",
          title: "Workflow completed",
          status: "completed",
          start: e.time,
          end: "",
          attempt: 1,
          detail: { result: a.result },
          failure: "",
        });
        break;
      }
      case "WORKFLOW_EXECUTION_FAILED":
      case "WORKFLOW_EXECUTION_TIMED_OUT":
      case "WORKFLOW_EXECUTION_TERMINATED":
      case "WORKFLOW_EXECUTION_CANCELED": {
        const f = a.failure as { message?: string } | undefined;
        units.push({
          kind: "end",
          title: `Workflow ${prettyType(e.type.replace("WORKFLOW_EXECUTION_", "")).toLowerCase()}`,
          status: "failed",
          start: e.time,
          end: "",
          attempt: 1,
          detail: {},
          failure: e.failure || f?.message || "",
        });
        break;
      }
      case "WORKFLOW_TASK_COMPLETED":
        taskCycles += 1;
        break;
      default:
        break;
    }
  }
  return { units, taskCycles };
}

function UnitIcon({ unit }: { unit: Unit }) {
  if (unit.status === "failed" || unit.status === "timedOut") {
    return <XCircle className="size-4 text-red-400" />;
  }
  if (unit.kind === "start") {
    return <Play className="size-4 text-sky-400" />;
  }
  if (unit.kind === "end") {
    return <Flag className="size-4 text-emerald-400" />;
  }
  if (unit.kind === "timer") {
    return <Clock className="size-4 text-amber-400" />;
  }
  if (unit.kind === "signal") {
    return <Zap className="size-4 text-violet-400" />;
  }
  if (unit.status === "completed") {
    return <CheckCircle2 className="size-4 text-emerald-400" />;
  }
  return <Play className="size-4 text-sky-400" />;
}

function dotClass(unit: Unit): string {
  if (unit.status === "failed" || unit.status === "timedOut") {
    return "bg-red-500";
  }
  if (unit.status === "completed" || unit.status === "fired") {
    return "bg-emerald-500";
  }
  if (unit.kind === "timer") {
    return "bg-amber-500";
  }
  if (unit.kind === "signal") {
    return "bg-violet-500";
  }
  return "bg-sky-500";
}

function Stat({
  label,
  value,
  cls,
}: {
  label: string;
  value: string;
  cls?: string;
}) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <div className="text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </div>
      <div className={`mt-0.5 font-semibold text-lg ${cls ?? ""}`}>{value}</div>
    </div>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: breadth-heavy presentational page (data prep + multiple conditional sections of JSX); complexity is from rendering branches, not control-flow logic, and extraction would only relocate it.
export default async function WorkflowDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ runId?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const runId = sp.runId ?? "";
  const d = await getWorkflowDetail(id, runId);

  if (!(d.available && d.info.type)) {
    return (
      <div className="p-6">
        <Link
          className="mb-4 inline-flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
          href="/temporal"
        >
          <ArrowLeft className="size-4" /> Back to workflows
        </Link>
        <p className="text-muted-foreground text-sm">
          Workflow not found or unavailable. {d.notes ?? ""}
        </p>
      </div>
    );
  }

  const i = d.info;
  const { units, taskCycles } = groupEvents(d.events);
  const topFailure = units.find((u) => u.failure)?.failure ?? "";

  const acts = units.filter((u) => u.kind === "activity");
  const failedCount = acts.filter(
    (u) => u.status === "failed" || u.status === "timedOut"
  ).length;
  const totalMs =
    durMs(i.start, i.close) ||
    durMs(units.at(0)?.start ?? "", units.at(-1)?.start ?? "");
  const maxActMs = Math.max(1, ...acts.map((u) => durMs(u.start, u.end)));

  // activities grouped by name
  const byName = new Map<
    string,
    { count: number; ms: number; failed: number }
  >();
  for (const u of acts) {
    const g = byName.get(u.title) ?? { count: 0, ms: 0, failed: 0 };
    g.count += 1;
    g.ms += durMs(u.start, u.end);
    if (u.status === "failed" || u.status === "timedOut") {
      g.failed += 1;
    }
    byName.set(u.title, g);
  }
  const actSummary = [...byName.entries()].sort((a, b) => b[1].ms - a[1].ms);

  const startUnit = units.find((u) => u.kind === "start");
  const input = (startUnit?.detail as { input?: unknown } | undefined)?.input;

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-6">
      <Link
        className="inline-flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
        href="/temporal"
      >
        <ArrowLeft className="size-4" /> Back to workflows
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 font-semibold text-xl">
            <Workflow className="size-5 text-[#00d4a0]" />
            {i.type}
          </h1>
          <p className="mt-1 break-all font-mono text-muted-foreground text-xs">
            {i.id}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span
              className={`rounded-full border px-2 py-0.5 ${statusClass(i.status)}`}
            >
              {i.status}
            </span>
            <span className="text-muted-foreground">{i.taskQueue}</span>
            <span className="text-muted-foreground">{fmtTime(i.start)}</span>
          </div>
        </div>
        <a
          className="inline-flex items-center gap-1 rounded-full border border-[#00d4a0]/30 bg-[#00d4a0]/10 px-3 py-1 text-[#00d4a0] text-sm hover:underline"
          href={cloudConsoleUrl(RC_NAMESPACE, i.id, i.runId)}
          rel="noreferrer"
          target="_blank"
        >
          Open in Temporal Cloud <ExternalLink className="size-3.5" />
        </a>
      </div>

      {topFailure && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
          <div className="mb-1 font-medium text-red-400 text-sm">Failure</div>
          <div className="break-words text-red-300/90 text-sm">
            {topFailure}
          </div>
        </div>
      )}

      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total time" value={durStr(totalMs) || "—"} />
        <Stat label="Activities" value={String(acts.length)} />
        <Stat
          cls={failedCount ? "text-red-400" : "text-emerald-400"}
          label="Failed"
          value={String(failedCount)}
        />
        <Stat label="Events" value={`${i.historyLength} · ${taskCycles} cyc`} />
      </div>

      {input != null && (
        <details className="rounded-xl border bg-card" open>
          <summary className="cursor-pointer px-4 py-2 font-medium text-sm">
            Order input
          </summary>
          <pre className="max-h-72 overflow-auto border-t px-4 py-3 text-muted-foreground text-xs">
            {JSON.stringify(input, null, 2)}
          </pre>
        </details>
      )}

      {actSummary.length > 0 && (
        <section>
          <h2 className="mb-2 font-medium text-sm">Activities</h2>
          <div className="overflow-hidden rounded-xl border bg-card">
            {actSummary.map(([name, g]) => (
              <div
                className="flex items-center gap-3 border-b px-4 py-2 text-sm last:border-0"
                key={name}
              >
                <span className="min-w-0 flex-1 truncate font-medium">
                  {name}
                </span>
                {g.failed > 0 && (
                  <span className="shrink-0 rounded border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-red-400 text-xs">
                    {g.failed} failed
                  </span>
                )}
                <span className="shrink-0 text-muted-foreground text-xs">
                  ×{g.count}
                </span>
                <span className="w-16 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
                  {durStr(g.ms) || "—"}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 font-medium text-sm">
          Execution timeline{" "}
          <span className="text-muted-foreground">({units.length} steps)</span>
        </h2>
        <ol className="ml-2 space-y-3 border-border border-l">
          {units.map((u, idx) => {
            const ms = durMs(u.start, u.end);
            const dur = durStr(ms);
            const barPct =
              u.kind === "activity" && ms
                ? Math.max(3, (ms / maxActMs) * 100)
                : 0;
            const hasDetail =
              Boolean(u.failure) ||
              Boolean(u.detail && Object.keys(u.detail as object).length > 0);
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: Unit has no unique id; index disambiguates units that share the same kind+start timestamp, and the list is render-only (never reordered/mutated client-side).
              <li className="relative pl-6" key={`${u.kind}:${idx}:${u.start}`}>
                <span
                  className={`absolute top-2 -left-[7px] size-3 rounded-full ring-4 ring-background ${dotClass(u)}`}
                />
                <div className="rounded-lg border bg-card">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <UnitIcon unit={u} />
                    <span className="min-w-0 flex-1 truncate font-medium text-sm">
                      {u.title}
                    </span>
                    {u.attempt > 1 && (
                      <span className="shrink-0 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-amber-400 text-xs">
                        {u.attempt}×
                      </span>
                    )}
                    {dur && (
                      <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                        {dur}
                      </span>
                    )}
                  </div>
                  {barPct > 0 && (
                    <div className="px-3 pb-1.5">
                      <div className="h-1 w-full overflow-hidden rounded bg-muted/40">
                        <div
                          className={`h-full rounded ${u.status === "failed" ? "bg-red-500/70" : "bg-[#00d4a0]/60"}`}
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {u.failure && (
                    <div className="border-red-500/20 border-t px-3 py-1.5 text-red-300/90 text-xs">
                      {u.failure}
                    </div>
                  )}
                  {hasDetail && (
                    <details className="group border-t">
                      <summary className="cursor-pointer list-none px-3 py-1 text-muted-foreground text-xs hover:text-foreground">
                        payload
                      </summary>
                      <pre className="max-h-72 overflow-auto px-3 pb-2 text-muted-foreground text-xs">
                        {JSON.stringify(u.detail, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <details className="rounded-xl border bg-card">
        <summary className="cursor-pointer px-4 py-2 text-muted-foreground text-sm hover:text-foreground">
          Raw event history ({d.events.length})
        </summary>
        <div className="border-t">
          {d.events.map((e) => (
            <div
              className="flex items-center gap-3 border-b px-4 py-1.5 text-xs last:border-0"
              key={`${e.id}:${e.type}`}
            >
              <span className="w-8 shrink-0 text-right text-muted-foreground">
                {e.id}
              </span>
              <span className={e.failure ? "text-red-400" : ""}>
                {prettyType(e.type)}
              </span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
