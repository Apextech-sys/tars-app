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

function duration(a: string, b: string): string {
  if (!(a && b)) {
    return "";
  }
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (Number.isNaN(ms) || ms < 0) {
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
  status: string; // completed | failed | running | scheduled | fired | ""
  start: string;
  end: string;
  attempt: number;
  detail: unknown;
  failure: string;
}

/** Collapse the raw event history into meaningful execution units (Temporal "compact" style). */
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

  if (!d.available || !d.info.type) {
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
            <span className="text-muted-foreground">
              {i.taskQueue} · {i.historyLength} events · {taskCycles} task cycles
            </span>
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
          <div className="break-words text-red-300/90 text-sm">{topFailure}</div>
        </div>
      )}

      {d.pending.length > 0 && (
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-2 font-medium text-sm">
            Pending activities ({d.pending.length})
          </div>
          {d.pending.map((p, idx) => (
            <div className="text-muted-foreground text-sm" key={idx}>
              {p.activityType} · attempt {p.attempt}
              {p.lastFailure ? ` · ${p.lastFailure}` : ""}
            </div>
          ))}
        </div>
      )}

      <section>
        <h2 className="mb-3 font-medium text-sm">
          Execution timeline{" "}
          <span className="text-muted-foreground">({units.length} steps)</span>
        </h2>
        <ol className="ml-2 space-y-3 border-border border-l">
          {units.map((u, idx) => {
            const dur = duration(u.start, u.end);
            const hasDetail =
              Boolean(u.failure) ||
              (u.detail && Object.keys(u.detail as object).length > 0);
            return (
              <li className="relative pl-6" key={`${u.kind}:${idx}:${u.start}`}>
                <span
                  className={`-left-[7px] absolute top-2 size-3 rounded-full ring-4 ring-background ${dotClass(u)}`}
                />
                <div className="rounded-lg border bg-card">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <UnitIcon unit={u} />
                    <span className="min-w-0 flex-1 truncate font-medium text-sm">
                      {u.title}
                    </span>
                    {u.attempt > 1 && (
                      <span className="shrink-0 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-amber-400 text-xs">
                        {u.attempt} attempts
                      </span>
                    )}
                    {dur && (
                      <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                        {dur}
                      </span>
                    )}
                    <span className="shrink-0 text-muted-foreground text-xs">
                      {fmtTime(u.start).slice(11)}
                    </span>
                  </div>
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
                      <pre className="overflow-x-auto px-3 pb-2 text-muted-foreground text-xs">
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
