import { ArrowLeft, ExternalLink, Workflow } from "lucide-react";
import Link from "next/link";
import {
  cloudConsoleUrl,
  getWorkflowDetail,
  type HistoryEvent,
} from "@/lib/tars/graph-temporal";

export const dynamic = "force-dynamic";

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

/** Colour the timeline dot by event category. */
function dotClass(type: string): string {
  if (type.includes("FAILED") || type.includes("TIMED_OUT")) {
    return "bg-red-500";
  }
  if (type.includes("COMPLETED")) {
    return "bg-emerald-500";
  }
  if (type.startsWith("ACTIVITY")) {
    return "bg-[#00d4a0]";
  }
  if (type.startsWith("TIMER")) {
    return "bg-amber-500";
  }
  if (type.includes("SIGNAL")) {
    return "bg-violet-500";
  }
  if (type.includes("STARTED") && type.startsWith("WORKFLOW_EXECUTION")) {
    return "bg-sky-500";
  }
  return "bg-zinc-600";
}

function prettyType(t: string): string {
  return t
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

function eventSummary(e: HistoryEvent): string {
  const a = (e.attrs ?? {}) as Record<string, unknown>;
  const at = a.activityType as { name?: string } | undefined;
  if (at?.name) {
    return at.name;
  }
  const wt = a.workflowType as { name?: string } | undefined;
  if (wt?.name) {
    return wt.name;
  }
  if (typeof a.timerId === "string") {
    return `timer ${a.timerId}`;
  }
  if (typeof a.signalName === "string") {
    return `signal ${a.signalName}`;
  }
  return "";
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
  const failures = d.events.filter((e) => e.failure);

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
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
              task queue {i.taskQueue}
            </span>
            <span className="text-muted-foreground">
              {i.historyLength} events
            </span>
            <span className="text-muted-foreground">{fmtTime(i.start)}</span>
          </div>
        </div>
        <a
          className="inline-flex items-center gap-1 rounded-full border border-[#00d4a0]/30 bg-[#00d4a0]/10 px-3 py-1 text-[#00d4a0] text-sm hover:underline"
          href={cloudConsoleUrl(
            // namespace embedded in the cloud URL; reuse the standard RC namespace
            "quickstart-reflex-connect-01.d817x",
            i.id,
            i.runId
          )}
          rel="noreferrer"
          target="_blank"
        >
          Open in Temporal Cloud <ExternalLink className="size-3.5" />
        </a>
      </div>

      {failures.length > 0 && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
          <div className="mb-1 font-medium text-red-400 text-sm">
            Failure ({failures.length})
          </div>
          {failures.slice(0, 4).map((e) => (
            <div className="text-red-300/90 text-sm" key={e.id}>
              <span className="text-red-400/70 text-xs">
                #{e.id} {prettyType(e.type)}:{" "}
              </span>
              {e.failure}
            </div>
          ))}
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
        <h2 className="mb-2 font-medium text-sm">Event history</h2>
        <div className="rounded-xl border bg-card">
          {d.events.map((e) => {
            const summary = eventSummary(e);
            return (
              <details
                className="group border-b last:border-0"
                key={`${e.id}:${e.type}`}
              >
                <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2 text-sm hover:bg-accent/40">
                  <span className="w-8 shrink-0 text-right text-muted-foreground text-xs">
                    {e.id}
                  </span>
                  <span
                    className={`size-2 shrink-0 rounded-full ${dotClass(e.type)}`}
                  />
                  <span
                    className={`shrink-0 font-medium ${e.failure ? "text-red-400" : ""}`}
                  >
                    {prettyType(e.type)}
                  </span>
                  {summary && (
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {summary}
                    </span>
                  )}
                  <span className="ml-auto shrink-0 text-muted-foreground text-xs">
                    {fmtTime(e.time).slice(11)}
                  </span>
                </summary>
                {e.failure && (
                  <div className="px-4 pb-1 text-red-300/90 text-xs">
                    {e.failure}
                  </div>
                )}
                <pre className="overflow-x-auto px-4 pb-3 text-muted-foreground text-xs">
                  {JSON.stringify(e.attrs, null, 2)}
                </pre>
              </details>
            );
          })}
        </div>
      </section>
    </div>
  );
}
