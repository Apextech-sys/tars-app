"use client";

import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  ShieldAlert,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { approvalActionFromInbox } from "@/app/inbox/actions";
import { cn } from "@/lib/utils";
import type { AttentionItem, AttentionSeverity } from "./types";
import { relativeAge } from "./types";

interface SevStyle {
  dot: string;
  chip: string;
  label: string;
}

const SEV_STYLE: Record<AttentionSeverity, SevStyle> = {
  blocker: {
    dot: "bg-red-500",
    chip: "border-red-500/30 bg-red-500/10 text-red-400",
    label: "Blocker",
  },
  warn: {
    dot: "bg-amber-500",
    chip: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    label: "Warn",
  },
  info: {
    dot: "bg-muted-foreground/50",
    chip: "border-border bg-muted/40 text-muted-foreground",
    label: "Info",
  },
};

const FILTERS: { key: "all" | AttentionSeverity; label: string }[] = [
  { key: "all", label: "All" },
  { key: "blocker", label: "Blockers" },
  { key: "warn", label: "Warnings" },
  { key: "info", label: "Info" },
];

const VISIBLE_CAP = 8;

const SEVERITY_BADGE: Record<string, string> = {
  critical: "border-red-500/40 bg-red-500/10 text-red-400",
  blocker: "border-red-500/40 bg-red-500/10 text-red-400",
  major: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  high: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  minor: "border-border bg-muted/40 text-muted-foreground",
  low: "border-border bg-muted/40 text-muted-foreground",
  info: "border-border bg-muted/40 text-muted-foreground",
};

function findingBadgeClass(severity: string): string {
  return (
    SEVERITY_BADGE[severity.toLowerCase()] ??
    "border-border bg-muted/40 text-muted-foreground"
  );
}

function ItemActions({
  item,
  onActed,
}: {
  item: AttentionItem;
  onActed: (id: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!item.approvableRunId) {
    return (
      <Link
        className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground"
        href={item.href}
      >
        Open
        <ChevronRight className="size-3.5" />
      </Link>
    );
  }

  const act = (action: "approve" | "reject") => {
    setError(null);
    startTransition(async () => {
      const runId = item.approvableRunId;
      if (!runId) {
        return;
      }
      const res = await approvalActionFromInbox(runId, action);
      if (res.ok) {
        onActed(item.id);
      } else {
        setError(res.error ?? "Action failed");
      }
    });
  };

  return (
    <div className="flex items-center gap-1.5">
      {error ? <span className="text-red-400 text-xs">{error}</span> : null}
      <button
        className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-[#00d4a0]/40 bg-[#00d4a0]/10 px-2.5 py-1 font-medium text-[#00d4a0] text-xs transition-colors hover:bg-[#00d4a0]/20 disabled:opacity-50"
        disabled={pending}
        onClick={() => act("approve")}
        type="button"
      >
        <Check className="size-3.5" />
        Approve
      </button>
      <button
        className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/5 px-2.5 py-1 font-medium text-rose-400 text-xs transition-colors hover:bg-rose-500/15 disabled:opacity-50"
        disabled={pending}
        onClick={() => act("reject")}
        type="button"
      >
        <X className="size-3.5" />
        Reject
      </button>
    </div>
  );
}

function AttentionRow({
  item,
  onActed,
}: {
  item: AttentionItem;
  onActed: (id: string) => void;
}) {
  const st = SEV_STYLE[item.severity];
  const hasFindings = item.findings.length > 0;
  const age = item.ageMs > 0 ? relativeAge(item.ageMs) : null;

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={cn("size-2 shrink-0 rounded-full", st.dot)} />
        <span className="min-w-0 flex-1 truncate font-medium text-sm">
          {item.title}
        </span>
        {age ? (
          <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
            {age}
          </span>
        ) : null}
        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-0.5 text-xs",
            st.chip
          )}
        >
          {st.label}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2 pl-5">
        <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
          {item.context}
        </span>
        {item.externalHref ? (
          <a
            className="inline-flex shrink-0 items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
            href={item.externalHref}
            rel="noreferrer"
            target="_blank"
          >
            GitHub
            <ExternalLink className="size-3" />
          </a>
        ) : null}
        <ItemActions item={item} onActed={onActed} />
      </div>
      {hasFindings ? (
        <details className="group mt-2 pl-5">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[#00d4a0] text-xs hover:underline">
            <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
            Show {item.findings.length} finding
            {item.findings.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-2 space-y-2 border-l pl-3">
            {item.findings.map((f) => (
              <li
                className="text-xs"
                key={`${item.id}-${f.file}-${f.line}-${f.severity}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
                      findingBadgeClass(f.severity)
                    )}
                  >
                    {f.severity}
                  </span>
                  <span className="font-mono text-muted-foreground">
                    {f.file}
                    {f.line ? `:${f.line}` : ""}
                  </span>
                </div>
                <p className="mt-1 text-foreground/90">{f.message}</p>
                {f.suggestion ? (
                  <p className="mt-1 text-muted-foreground">
                    Fix: {f.suggestion}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export function AttentionPanel({ items }: { items: AttentionItem[] }) {
  const [filter, setFilter] = useState<"all" | AttentionSeverity>("all");
  const [acted, setActed] = useState<Set<string>>(new Set());

  const onActed = (id: string) => {
    setActed((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  const live = useMemo(
    () => items.filter((i) => !acted.has(i.id)),
    [items, acted]
  );
  const filtered = useMemo(
    () => (filter === "all" ? live : live.filter((i) => i.severity === filter)),
    [live, filter]
  );

  if (live.length === 0) {
    return (
      <section className="rounded-xl border border-[#00d4a0]/30 bg-[#00d4a0]/10 px-4 py-6 text-[#00d4a0]">
        <div className="flex items-center gap-2 font-medium">
          <CheckCircle2 className="size-5" />
          All clear — nothing needs your attention
        </div>
        <p className="mt-1 text-[#00d4a0]/70 text-sm">
          No pending approvals, disagreements, errored runs, degraded services,
          or security alarms.
        </p>
      </section>
    );
  }

  const visible = filtered.slice(0, VISIBLE_CAP);
  const overflow = filtered.slice(VISIBLE_CAP);
  const blockerCount = live.filter((i) => i.severity === "blocker").length;
  const HeaderIcon = blockerCount > 0 ? ShieldAlert : AlertTriangle;
  const headerColor = blockerCount > 0 ? "text-red-400" : "text-amber-400";

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold text-sm">
          <HeaderIcon className={cn("size-4", headerColor)} />
          Attention required
          <span className="font-normal text-muted-foreground">
            · {live.length} item{live.length === 1 ? "" : "s"}
          </span>
        </h2>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const count =
              f.key === "all"
                ? live.length
                : live.filter((i) => i.severity === f.key).length;
            return (
              <button
                className={cn(
                  "inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors",
                  filter === f.key
                    ? "border-[#00d4a0]/40 bg-[#00d4a0]/10 text-[#00d4a0]"
                    : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
                key={f.key}
                onClick={() => setFilter(f.key)}
                type="button"
              >
                {f.label}
                <span className="tabular-nums">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {visible.length === 0 ? (
          <div className="px-4 py-6 text-center text-muted-foreground text-sm">
            No {filter} items.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {visible.map((item) => (
              <AttentionRow item={item} key={item.id} onActed={onActed} />
            ))}
          </div>
        )}
        {overflow.length > 0 ? (
          <details className="group border-border border-t">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 px-4 py-2.5 text-[#00d4a0] text-sm hover:bg-accent/40">
              <ChevronRight className="size-4 transition-transform group-open:rotate-90" />
              Show {overflow.length} more
            </summary>
            <div className="divide-y divide-border border-border border-t">
              {overflow.map((item) => (
                <AttentionRow item={item} key={item.id} onActed={onActed} />
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </section>
  );
}
