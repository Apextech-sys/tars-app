import { Activity, ExternalLink, Workflow } from "lucide-react";
import {
  cloudConsoleUrl,
  getTemporal,
  namespaceUrl,
} from "@/lib/tars/graph-temporal";

export const dynamic = "force-dynamic";

function relativeTime(iso: string): string {
  if (!iso) {
    return "—";
  }
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) {
    return `${s}s ago`;
  }
  const m = Math.floor(s / 60);
  if (m < 60) {
    return `${m}m ago`;
  }
  const h = Math.floor(m / 60);
  if (h < 24) {
    return `${h}h ago`;
  }
  return `${Math.floor(h / 24)}d ago`;
}

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

const COUNT_CARDS: { key: string; label: string; cls: string }[] = [
  { key: "running", label: "Running", cls: "text-sky-400" },
  { key: "failed", label: "Failed", cls: "text-red-400" },
  { key: "completed", label: "Completed", cls: "text-emerald-400" },
  { key: "terminated", label: "Terminated", cls: "text-amber-400" },
];

export default async function TemporalPage() {
  const t = await getTemporal();

  if (!t.available) {
    return (
      <div className="p-6 text-muted-foreground text-sm">
        Temporal view unavailable. {t.notes ?? ""}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-semibold text-xl">
            <Workflow className="size-5 text-[#00d4a0]" /> Temporal Workflows
          </h1>
          <p className="text-muted-foreground text-sm">
            Reflex Connect order orchestration · namespace{" "}
            <span className="font-mono text-xs">{t.namespace}</span> · read-only
          </p>
        </div>
        <a
          className="inline-flex items-center gap-1 rounded-full border border-[#00d4a0]/30 bg-[#00d4a0]/10 px-3 py-1 text-[#00d4a0] text-sm hover:underline"
          href={namespaceUrl(t.namespace)}
          rel="noreferrer"
          target="_blank"
        >
          Open in Temporal Cloud <ExternalLink className="size-3.5" />
        </a>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {COUNT_CARDS.map((c) => (
          <div className="rounded-xl border bg-card p-4" key={c.key}>
            <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase">
              <Activity className="size-4" />
              {c.label}
            </div>
            <div className={`mt-1 font-semibold text-2xl ${c.cls}`}>
              {t.counts[c.key] ?? 0}
            </div>
          </div>
        ))}
      </div>

      <section>
        <h2 className="mb-2 font-medium text-sm">
          Recent executions{" "}
          <span className="text-muted-foreground">({t.workflows.length})</span>
        </h2>
        <div className="overflow-hidden rounded-xl border bg-card">
          {t.workflows.map((w) => (
            <div
              className="flex items-center gap-3 border-b px-4 py-2 text-sm last:border-0"
              key={`${w.id}:${w.runId}`}
            >
              <span
                className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-xs ${statusClass(
                  w.status
                )}`}
              >
                {w.status || "—"}
              </span>
              <span className="w-48 shrink-0 truncate font-medium">
                {w.type}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-xs">
                {w.id}
              </span>
              <span className="w-20 shrink-0 text-right text-muted-foreground text-xs">
                {relativeTime(w.start)}
              </span>
              <a
                aria-label="Open in Temporal Cloud"
                className="shrink-0 text-[#00d4a0] hover:text-[#00d4a0]/80"
                href={cloudConsoleUrl(t.namespace, w.id, w.runId)}
                rel="noreferrer"
                target="_blank"
              >
                <ExternalLink className="size-4" />
              </a>
            </div>
          ))}
          {t.workflows.length === 0 && (
            <div className="px-4 py-3 text-muted-foreground text-sm">
              No executions found.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
