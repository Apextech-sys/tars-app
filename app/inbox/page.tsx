"use client";

import { CheckCircle2, Inbox, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { DecisionCard } from "@/components/inbox/decision-card";
import { FyiColumn } from "@/components/inbox/fyi-group";
import { InboxHero } from "@/components/inbox/inbox-hero";
import { NotificationPermissionBanner } from "@/components/tars/notification-permission-banner";
import { Button } from "@/components/ui/button";
import { useNotifications } from "@/hooks/use-notifications";
import { cn } from "@/lib/utils";
import {
  approveManyFromInbox,
  fetchInboxData,
  getInboxSummary,
  type InboxData,
  type InboxItem,
  type InboxSummary,
} from "./actions";

const EMPTY_DATA: InboxData = { needsDecision: [], fyi: [] };
const EMPTY_SUMMARY: InboxSummary = {
  pendingApproval: 0,
  disagreed: 0,
  criticalFindings: 0,
  stalled: 0,
  errored: 0,
  failedJobs7d: 0,
  oldestWaitingMs: null,
  workerLastSeenMs: null,
  workerId: null,
  latestBrief: null,
};

type DecisionFilter = "all" | "approvals" | "disagreements" | "escalations";

const DECISION_FILTERS: { label: string; value: DecisionFilter }[] = [
  { label: "All", value: "all" },
  { label: "Approvals", value: "approvals" },
  { label: "Disagreements", value: "disagreements" },
  { label: "Escalations", value: "escalations" },
];

function matchesFilter(item: InboxItem, filter: DecisionFilter): boolean {
  if (filter === "all") {
    return true;
  }
  if (filter === "approvals") {
    return item.kind === "pr_pending_approval";
  }
  if (filter === "disagreements") {
    return item.kind === "pr_disagreement";
  }
  return item.kind === "escalation";
}

export default function InboxPage() {
  const [data, setData] = useState<InboxData>(EMPTY_DATA);
  const [summary, setSummary] = useState<InboxSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<DecisionFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { notify, promptPermission } = useNotifications();
  const eventSourceRef = useRef<EventSource | null>(null);
  const [isPending, startTransition] = useTransition();
  const decisionRef = useRef<HTMLDivElement | null>(null);
  const healthRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(() => {
    startTransition(async () => {
      setLoading(true);
      const [items, sum] = await Promise.all([
        fetchInboxData(),
        getInboxSummary(),
      ]);
      setData(items);
      setSummary(sum);
      setSelected(new Set());
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const es = new EventSource("/api/inbox/sse");
    eventSourceRef.current = es;
    es.onmessage = (event: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(event.data) as {
          type: string;
          payload?: { id?: string; title?: string; severity?: string };
        };
        if (msg.type === "escalation_changed") {
          refresh();
          const id = msg.payload?.id ?? "unknown";
          const title = msg.payload?.title ?? "New escalation";
          const severity =
            (msg.payload?.severity as "info" | "warn" | "blocker") ?? "warn";
          notify(id, `TARS — ${title}`, `Severity: ${severity}`, severity);
        }
      } catch {
        // ignore parse errors
      }
    };
    return () => {
      es.close();
    };
  }, [refresh, notify]);

  const handleJump = useCallback((target: string) => {
    if (target === "health") {
      healthRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (target === "approvals" || target === "disagreements") {
      setFilter(target);
    } else {
      setFilter("all");
    }
    decisionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const toggleSelect = useCallback((id: string, v: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (v) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const visibleDecision = data.needsDecision.filter((i) =>
    matchesFilter(i, filter)
  );

  const selectedRunIds = data.needsDecision
    .filter(
      (i): i is Extract<InboxItem, { kind: "pr_pending_approval" }> =>
        i.kind === "pr_pending_approval" && selected.has(i.id)
    )
    .map((i) => i.runId);

  const handleBulkApprove = () => {
    startTransition(async () => {
      const res = await approveManyFromInbox(selectedRunIds);
      toast.success(
        `Approved ${res.approved} run${res.approved === 1 ? "" : "s"}`
      );
      refresh();
    });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <NotificationPermissionBanner onRequest={promptPermission} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-semibold text-xl">
            <Inbox className="size-5 text-[#00d4a0]" /> Inbox
          </h1>
          <p className="text-muted-foreground text-sm">
            Triage queue · {data.needsDecision.length} decision
            {data.needsDecision.length === 1 ? "" : "s"} · {data.fyi.length} FYI
          </p>
        </div>
        <Button
          className="min-h-[44px]"
          disabled={isPending || loading}
          onClick={refresh}
          size="sm"
          variant="outline"
        >
          <RefreshCw className={cn("size-4", isPending && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <InboxHero onJump={handleJump} summary={summary} />

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading queue…
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          {/* Needs decision */}
          <div className="space-y-3" ref={decisionRef}>
            <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 bg-background/80 py-1 backdrop-blur">
              <h2 className="font-semibold text-sm uppercase tracking-wide">
                Needs decision
              </h2>
              <span className="rounded-full bg-[#00d4a0]/10 px-2 py-0.5 text-[#00d4a0] text-xs tabular-nums">
                {visibleDecision.length}
              </span>
              <div className="ml-auto flex flex-wrap gap-1">
                {DECISION_FILTERS.map((f) => (
                  <button
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs transition-colors",
                      filter === f.value
                        ? "border-[#00d4a0]/40 bg-[#00d4a0]/10 text-[#00d4a0]"
                        : "text-muted-foreground hover:bg-accent"
                    )}
                    key={f.value}
                    onClick={() => setFilter(f.value)}
                    type="button"
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {visibleDecision.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-12 text-muted-foreground">
                <CheckCircle2 className="size-6 text-[#00d4a0]" />
                <p className="text-sm">Nothing waiting on your decision.</p>
              </div>
            ) : (
              visibleDecision.map((item) => (
                <DecisionCard
                  item={item}
                  key={item.id}
                  onAction={refresh}
                  onSelectChange={(v: boolean) => toggleSelect(item.id, v)}
                  selected={selected.has(item.id)}
                />
              ))
            )}
          </div>

          {/* FYI / system health */}
          <div className="space-y-3" ref={healthRef}>
            <div className="flex flex-wrap items-center gap-2 py-1">
              <h2 className="font-semibold text-sm uppercase tracking-wide">
                FYI · system health
              </h2>
              <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs tabular-nums">
                {data.fyi.length}
              </span>
            </div>
            <FyiColumn items={data.fyi} onAction={refresh} />
          </div>
        </div>
      )}

      {selectedRunIds.length > 0 ? (
        <div className="sticky bottom-4 z-20 mx-auto flex w-fit items-center gap-3 rounded-full border bg-card px-4 py-2 shadow-lg">
          <span className="text-sm tabular-nums">
            {selectedRunIds.length} selected
          </span>
          <Button
            className="min-h-[40px] bg-emerald-600 text-white hover:bg-emerald-700"
            disabled={isPending}
            onClick={handleBulkApprove}
            size="sm"
          >
            <CheckCircle2 className="size-3.5" /> Approve selected
          </Button>
          <Button
            className="min-h-[40px]"
            disabled={isPending}
            onClick={() => setSelected(new Set())}
            size="sm"
            variant="ghost"
          >
            Clear
          </Button>
        </div>
      ) : null}
    </div>
  );
}
