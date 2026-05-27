"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { JsonTree } from "./json-tree";
import type { AuditLogRow } from "./types";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

function statusDotClass(status: string): string {
  if (status === "ok" || status === "done" || status === "success") {
    return "bg-emerald-500";
  }
  if (status === "error" || status === "failed") {
    return "bg-red-500";
  }
  if (status === "info" || status === "started") {
    return "bg-blue-500";
  }
  return "bg-zinc-500";
}

function statusRailClass(status: string): string {
  if (status === "ok" || status === "done" || status === "success") {
    return "border-emerald-500/30";
  }
  if (status === "error" || status === "failed") {
    return "border-red-500/30";
  }
  if (status === "info" || status === "started") {
    return "border-blue-500/30";
  }
  return "border-zinc-700";
}

function statusBadgeClass(status: string): string {
  if (status === "ok" || status === "done" || status === "success") {
    return "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30";
  }
  if (status === "error" || status === "failed") {
    return "bg-red-500/10 text-red-400 border border-red-500/30";
  }
  if (status === "info" || status === "started") {
    return "bg-blue-500/10 text-blue-400 border border-blue-500/30";
  }
  return "bg-zinc-800 text-zinc-400 border border-zinc-700";
}

function isDataFlat(data: unknown): boolean {
  if (data === null || data === undefined) return true;
  if (typeof data !== "object") return true;
  if (Array.isArray(data)) return false;
  const vals = Object.values(data as Record<string, unknown>);
  return vals.every((v) => typeof v !== "object" || v === null);
}

function FlatDataTable({ data }: { data: Record<string, unknown> }) {
  return (
    <table className="w-full text-xs">
      <tbody>
        {Object.entries(data).map(([key, val]) => (
          <tr key={key} className="border-b border-zinc-800 last:border-0">
            <td className="py-1 pr-3 font-mono text-blue-300 align-top whitespace-nowrap w-1/3">
              {key}
            </td>
            <td className="py-1 font-mono text-zinc-300 break-all">
              {val === null ? (
                <span className="text-zinc-600">null</span>
              ) : typeof val === "boolean" ? (
                <span className={val ? "text-emerald-400" : "text-red-400"}>
                  {String(val)}
                </span>
              ) : (
                String(val)
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AuditDataExpander({ data }: { data: unknown }) {
  if (data === null || data === undefined) {
    return <p className="text-xs text-zinc-600 italic">No data</p>;
  }

  if (typeof data !== "object" || Array.isArray(data)) {
    return <JsonTree data={data} />;
  }

  const obj = data as Record<string, unknown>;

  if (isDataFlat(data)) {
    return (
      <div className="rounded-md bg-zinc-950/60 border border-zinc-800 p-3">
        <FlatDataTable data={obj} />
      </div>
    );
  }

  return <JsonTree data={data} />;
}

export function AuditTimeline({ rows }: { rows: AuditLogRow[] }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        No audit log entries for this run.
      </p>
    );
  }

  return (
    <div className="space-y-0">
      {rows.map((row, idx) => {
        const isLast = idx === rows.length - 1;
        const isExpanded = expandedId === row.id;

        return (
          <div key={row.id} className="flex gap-3">
            {/* Left rail */}
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "size-3 rounded-full mt-1.5 shrink-0",
                  statusDotClass(row.status)
                )}
                aria-hidden="true"
              />
              {!isLast && (
                <div
                  className={cn(
                    "w-px flex-1 mt-1 border-l-2 border-dashed min-h-[24px]",
                    statusRailClass(row.status)
                  )}
                  aria-hidden="true"
                />
              )}
            </div>

            {/* Content */}
            <div className="flex-1 pb-4 min-w-0">
              <div className="flex flex-wrap items-start gap-2 mb-1">
                <span className="font-semibold text-sm">{row.step}</span>
                <span
                  className={cn(
                    "text-xs px-2 py-0.5 rounded-full uppercase tracking-wide",
                    statusBadgeClass(row.status)
                  )}
                >
                  {row.status}
                </span>
                <span className="text-xs text-muted-foreground ml-auto shrink-0">
                  {relativeTime(row.createdAt)}
                </span>
              </div>

              {row.message && (
                <p className="text-sm text-muted-foreground leading-relaxed mb-2">
                  {row.message}
                </p>
              )}

              {row.data !== null && row.data !== undefined && (
                <div className="mt-1">
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline flex items-center gap-1 min-h-[28px]"
                    aria-expanded={isExpanded}
                    onClick={() =>
                      setExpandedId(isExpanded ? null : row.id)
                    }
                  >
                    {isExpanded ? (
                      <ChevronDown className="size-3" />
                    ) : (
                      <ChevronRight className="size-3" />
                    )}
                    {isExpanded ? "Collapse data" : "Expand data"}
                  </button>
                  {isExpanded && (
                    <div className="mt-2">
                      <AuditDataExpander data={row.data} />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
