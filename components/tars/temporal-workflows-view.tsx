"use client";

import { ExternalLink, Search, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

interface WF {
  id: string;
  runId: string;
  type: string;
  status: string;
  start: string;
  close: string;
}

function fnoLabel(type: string): string {
  const t = type.toLowerCase();
  if (t.startsWith("mfn")) {
    return "MFN";
  }
  if (t.startsWith("frogfoot")) {
    return "Frogfoot";
  }
  if (t.startsWith("octotel")) {
    return "Octotel";
  }
  if (t.startsWith("openserve")) {
    return "Openserve";
  }
  if (t.startsWith("vuma")) {
    return "Vumatel";
  }
  return "";
}

function statusDot(status: string): string {
  const map: Record<string, string> = {
    RUNNING: "bg-sky-400",
    COMPLETED: "bg-emerald-400",
    FAILED: "bg-red-400",
    TERMINATED: "bg-amber-400",
    TIMED_OUT: "bg-orange-400",
    CANCELED: "bg-zinc-400",
  };
  return map[status] ?? "bg-zinc-500";
}

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

function durationStr(start: string, close: string): string {
  if (!(start && close)) {
    return "";
  }
  const ms = new Date(close).getTime() - new Date(start).getTime();
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
    return `${Math.floor(ms / 60_000)}m`;
  }
  return `${Math.floor(ms / 3_600_000)}h`;
}

const FILTERS: { key: string; label: string; cls: string; ring: string }[] = [
  { key: "RUNNING", label: "Running", cls: "text-sky-400", ring: "ring-sky-500/40" },
  { key: "FAILED", label: "Failed", cls: "text-red-400", ring: "ring-red-500/50" },
  {
    key: "COMPLETED",
    label: "Completed",
    cls: "text-emerald-400",
    ring: "ring-emerald-500/40",
  },
  {
    key: "TERMINATED",
    label: "Terminated",
    cls: "text-amber-400",
    ring: "ring-amber-500/40",
  },
];

export function TemporalWorkflowsView({
  namespace,
  counts,
  workflows,
}: {
  namespace: string;
  counts: Record<string, number>;
  workflows: WF[];
}) {
  const [status, setStatus] = useState<string>("ALL");
  const [query, setQuery] = useState("");
  const [type, setType] = useState<string>("ALL");

  const types = useMemo(
    () => [...new Set(workflows.map((w) => w.type))].sort(),
    [workflows]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return workflows.filter((w) => {
      if (status !== "ALL" && w.status !== status) {
        return false;
      }
      if (type !== "ALL" && w.type !== type) {
        return false;
      }
      if (
        q &&
        !(w.id.toLowerCase().includes(q) || w.type.toLowerCase().includes(q))
      ) {
        return false;
      }
      return true;
    });
  }, [workflows, status, query, type]);

  const active = status !== "ALL" || type !== "ALL" || query.trim() !== "";

  return (
    <div className="space-y-5">
      {/* Stat cards double as status filters */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {FILTERS.map((f) => {
          const on = status === f.key;
          return (
            <button
              className={`rounded-xl border bg-card p-4 text-left transition-colors hover:border-foreground/20 ${
                on ? `ring-2 ${f.ring}` : ""
              }`}
              key={f.key}
              onClick={() => setStatus(on ? "ALL" : f.key)}
              type="button"
            >
              <div className="text-muted-foreground text-xs uppercase tracking-wide">
                {f.label}
              </div>
              <div className={`mt-1 font-semibold text-2xl ${f.cls}`}>
                {counts[f.key.toLowerCase()] ?? 0}
              </div>
            </button>
          );
        })}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="-translate-y-1/2 absolute top-1/2 left-3 size-4 text-muted-foreground" />
          <input
            className="h-9 w-full rounded-lg border bg-background pl-9 pr-3 text-sm outline-none focus:border-[#00d4a0]/50"
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by workflow id or type…"
            value={query}
          />
        </div>
        <select
          className="h-9 rounded-lg border bg-background px-3 text-sm outline-none focus:border-[#00d4a0]/50"
          onChange={(e) => setType(e.target.value)}
          value={type}
        >
          <option value="ALL">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {active && (
          <button
            className="inline-flex h-9 items-center gap-1 rounded-lg border px-3 text-muted-foreground text-sm hover:text-foreground"
            onClick={() => {
              setStatus("ALL");
              setType("ALL");
              setQuery("");
            }}
            type="button"
          >
            <X className="size-3.5" /> Clear
          </button>
        )}
      </div>

      <div className="flex items-center justify-between text-muted-foreground text-xs">
        <span>
          {filtered.length} of {workflows.length} recent
          {active ? " (filtered)" : ""}
        </span>
      </div>

      {/* Rows */}
      <div className="overflow-hidden rounded-xl border bg-card">
        {filtered.map((w) => {
          const fno = fnoLabel(w.type);
          const dur = durationStr(w.start, w.close);
          return (
            <div
              className="flex items-center gap-3 border-b px-4 py-2.5 text-sm transition-colors last:border-0 hover:bg-accent/30"
              key={`${w.id}:${w.runId}`}
            >
              <Link
                className="flex min-w-0 flex-1 items-center gap-3"
                href={`/temporal/${encodeURIComponent(w.id)}?runId=${encodeURIComponent(
                  w.runId
                )}`}
              >
                <span
                  className={`size-2 shrink-0 rounded-full ${statusDot(w.status)}`}
                  title={w.status}
                />
                <span className="w-44 shrink-0 truncate font-medium">
                  {w.type}
                </span>
                {fno && (
                  <span className="hidden shrink-0 rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground uppercase sm:inline">
                    {fno}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-xs">
                  {w.id}
                </span>
                {dur && (
                  <span className="hidden w-12 shrink-0 text-right text-muted-foreground text-xs tabular-nums md:inline">
                    {dur}
                  </span>
                )}
                <span className="w-20 shrink-0 text-right text-muted-foreground text-xs">
                  {relativeTime(w.start)}
                </span>
              </Link>
              <a
                aria-label="Open in Temporal Cloud"
                className="shrink-0 text-muted-foreground hover:text-[#00d4a0]"
                href={`https://cloud.temporal.io/namespaces/${namespace}/workflows/${encodeURIComponent(
                  w.id
                )}/${w.runId}/history`}
                rel="noreferrer"
                target="_blank"
              >
                <ExternalLink className="size-4" />
              </a>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="px-4 py-8 text-center text-muted-foreground text-sm">
            No workflows match these filters.
          </div>
        )}
      </div>
    </div>
  );
}
