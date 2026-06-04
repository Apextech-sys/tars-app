"use client";

import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  ExternalLink,
  GitMerge,
  Loader2,
  MinusCircle,
  RefreshCw,
  Search,
  Webhook,
  X,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState, useTransition } from "react";
import { JsonTree } from "@/components/pr-runs/json-tree";
import type { WebhookFilter } from "@/components/tars/webhook-hero-band";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  decodeAction,
  relativeTime,
  type WebhookOutcome,
} from "@/lib/tars/webhook-helpers";
import type { WebhookStats } from "@/lib/tars/webhooks-stats";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

interface WebhookRow {
  id: number;
  eventType: string;
  deliveryId: string | null;
  repoKey: string;
  action: string | null;
  prNumber: number | null;
  prSha: string | null;
  prTitle: string | null;
  senderLogin: string | null;
  triggeredRun: string | null;
  createdAt: string;
}

interface WebhookDetail extends WebhookRow {
  rawPayload: unknown;
}

const OUTCOME_META: Record<
  WebhookOutcome,
  { icon: typeof CheckCircle2; tone: string; label: string }
> = {
  triggered: {
    icon: CheckCircle2,
    tone: "text-[#00d4a0]",
    label: "Triggered a review",
  },
  merged: { icon: GitMerge, tone: "text-purple-400", label: "Merged" },
  skipped: {
    icon: MinusCircle,
    tone: "text-muted-foreground",
    label: "Skipped (draft)",
  },
  no_action: {
    icon: CircleDashed,
    tone: "text-muted-foreground/60",
    label: "No action taken",
  },
};

function isBot(login: string | null): boolean {
  return login?.endsWith("[bot]") === true;
}

function FilterChip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "rounded-full border px-3 py-1 text-xs transition-colors",
        active
          ? "border-[#00d4a0]/50 bg-[#00d4a0]/15 text-[#00d4a0]"
          : "border-border text-muted-foreground hover:border-[#00d4a0]/30 hover:text-foreground"
      )}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function OutcomeReason(event: WebhookDetail): string {
  const decoded = decodeAction(event.action, event.triggeredRun !== null);
  if (decoded.outcome === "triggered") {
    return "A PR-review run was started for this delivery.";
  }
  if (decoded.outcome === "merged") {
    return "PR was merged — no new review run is started on merge.";
  }
  if (decoded.outcome === "skipped") {
    return "Draft PR — review skipped until marked ready for review.";
  }
  if (event.eventType !== "pull_request") {
    return `${event.eventType} events are recorded for visibility but do not start a review.`;
  }
  return "No review run was triggered (un-watched repo, or an action TARS does not review).";
}

function DetailPanel({
  event,
  onClose,
}: {
  event: WebhookDetail;
  onClose: () => void;
}) {
  const decoded = decodeAction(event.action, event.triggeredRun !== null);
  const meta = OUTCOME_META[decoded.outcome];
  const OutcomeIcon = meta.icon;
  return (
    <div
      aria-label={`Webhook event ${event.deliveryId ?? event.id}`}
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end justify-center p-0 md:items-center md:p-4"
      role="dialog"
    >
      <button
        aria-label="Close"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        type="button"
      />
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-t-xl border border-border bg-background shadow-2xl md:rounded-xl">
        <div className="flex shrink-0 items-center justify-between border-border border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Webhook className="size-4 text-muted-foreground" />
            <span className="font-medium text-sm">
              {event.eventType}
              {event.action ? ` · ${decoded.label}` : ""}
            </span>
          </div>
          <button
            aria-label="Close"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="shrink-0 space-y-3 border-border border-b px-4 py-3">
          <div
            className={cn(
              "flex items-start gap-2 rounded-lg border bg-card p-3 text-sm",
              meta.tone
            )}
          >
            <OutcomeIcon className="mt-0.5 size-4 shrink-0" />
            <div>
              <div className="font-medium">{meta.label}</div>
              <div className="text-muted-foreground text-xs">
                {OutcomeReason(event)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            {event.deliveryId ? (
              <div>
                <p className="text-muted-foreground text-xs">Delivery ID</p>
                <p className="truncate font-mono text-xs">{event.deliveryId}</p>
              </div>
            ) : null}
            <div>
              <p className="text-muted-foreground text-xs">Repo</p>
              <p className="font-mono text-xs">{event.repoKey}</p>
            </div>
            {event.prTitle ? (
              <div className="col-span-2">
                <p className="text-muted-foreground text-xs">PR title</p>
                <p className="text-xs">
                  {event.prNumber ? `#${event.prNumber} · ` : ""}
                  {event.prTitle}
                </p>
              </div>
            ) : null}
            {event.senderLogin ? (
              <div>
                <p className="text-muted-foreground text-xs">Sender</p>
                <p className="font-mono text-xs">@{event.senderLogin}</p>
              </div>
            ) : null}
            <div>
              <p className="text-muted-foreground text-xs">Received</p>
              <p className="text-xs">
                {new Date(event.createdAt).toLocaleString()}
              </p>
            </div>
            {event.triggeredRun ? (
              <div className="col-span-2">
                <p className="text-muted-foreground text-xs">Triggered run</p>
                <Link
                  className="flex items-center gap-1 font-mono text-[#00d4a0] text-xs hover:underline"
                  href={`/pr-runs/${encodeURIComponent(event.triggeredRun)}`}
                >
                  {event.triggeredRun}
                  <ExternalLink className="size-3" />
                </Link>
              </div>
            ) : null}
          </div>

          <button
            className="w-full cursor-not-allowed rounded-md border border-border py-1.5 text-muted-foreground/60 text-xs"
            disabled
            title="Re-running a review from a delivery needs the replay route (not yet built)"
            type="button"
          >
            Re-run PR review (coming soon)
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <p className="mb-2 text-muted-foreground text-xs uppercase tracking-wide">
            Raw payload
          </p>
          <JsonTree data={event.rawPayload} />
        </div>
      </div>
    </div>
  );
}

export function WebhookStream({
  stats,
  filter,
  onFilter,
}: {
  stats: WebhookStats;
  filter: WebhookFilter;
  onFilter: (next: WebhookFilter) => void;
}) {
  const [events, setEvents] = useState<WebhookRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [selectedEvent, setSelectedEvent] = useState<WebhookDetail | null>(
    null
  );
  const [detailLoading, setDetailLoading] = useState(false);
  const [search, setSearch] = useState("");

  const load = useCallback((f: WebhookFilter, term: string, p: number) => {
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: breadth of independent branches/panels in one cohesive view-builder, not tangled control flow; splitting would scatter co-located UI logic
    startTransition(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (f.repo) {
          params.set("repo", f.repo);
        }
        if (f.event) {
          params.set("event", f.event);
        }
        if (f.action) {
          params.set("action", f.action);
        }
        if (f.sender) {
          params.set("sender", f.sender);
        }
        if (f.outcome) {
          params.set("outcome", f.outcome);
        }
        if (f.since24h) {
          params.set("since", "24h");
        }
        if (term.trim()) {
          params.set("search", term.trim());
        }
        params.set("limit", String(PAGE_SIZE));
        params.set("offset", String(p * PAGE_SIZE));

        const res = await fetch(`/api/tars/webhooks?${params.toString()}`);
        const data = (await res.json()) as {
          events: WebhookRow[];
          total: number;
        };
        setEvents(data.events ?? []);
        setTotal(data.total ?? 0);
      } finally {
        setLoading(false);
      }
    });
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: callback takes all inputs as arguments and only closes over stable setters/startTransition; adding deps would cause redundant refetch loops
  useEffect(() => {
    setPage(0);
  }, [filter, search]);

  useEffect(() => {
    load(filter, search, page);
  }, [load, filter, search, page]);

  const openDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/tars/webhooks/${id}`);
      const data = (await res.json()) as WebhookDetail;
      setSelectedEvent(data);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const hasFilter = Boolean(
    filter.repo ||
      filter.event ||
      filter.action ||
      filter.sender ||
      filter.outcome ||
      filter.since24h ||
      search.trim()
  );

  const repoOptions = stats.byRepo.slice(0, 5);
  const typeOptions = stats.byType;
  const outcomeOptions: { key: string; label: string }[] = [
    { key: "triggered", label: "Triggered" },
    { key: "merged", label: "Merged" },
    { key: "skipped", label: "Skipped (draft)" },
    { key: "no_action", label: "No action" },
  ];

  function toggle(key: keyof WebhookFilter, value: string) {
    const current = filter[key];
    if (key === "since24h") {
      onFilter({ ...filter, since24h: !filter.since24h });
      return;
    }
    onFilter({ ...filter, [key]: current === value ? undefined : value });
  }

  return (
    <section className="space-y-3" id="event-stream">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-lg">Event stream</h2>
        <Button
          className="min-h-[44px]"
          disabled={isPending}
          onClick={() => load(filter, search, page)}
          size="sm"
          variant="outline"
        >
          <RefreshIcon spinning={isPending} />
          Refresh
        </Button>
      </div>

      <div className="space-y-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <FilterChip
            active={Boolean(filter.since24h)}
            onClick={() => toggle("since24h", "1")}
          >
            Last 24h
          </FilterChip>
          {typeOptions.map((t) => (
            <FilterChip
              active={filter.event === t.eventType}
              key={t.eventType}
              onClick={() => toggle("event", t.eventType)}
            >
              {t.eventType}
            </FilterChip>
          ))}
          {outcomeOptions.map((o) => (
            <FilterChip
              active={filter.outcome === o.key}
              key={o.key}
              onClick={() => toggle("outcome", o.key)}
            >
              {o.label}
            </FilterChip>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {repoOptions.map((r) => (
            <FilterChip
              active={filter.repo === r.repoKey}
              key={r.repoKey}
              onClick={() => toggle("repo", r.repoKey)}
            >
              <span className="font-mono">{r.repoKey.split("/")[1]}</span>
            </FilterChip>
          ))}
          <div className="relative ml-auto min-w-[180px] flex-1">
            <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-8 pl-7 text-xs"
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search PR title…"
              value={search}
            />
          </div>
        </div>

        {hasFilter ? (
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <span>Filtered</span>
            <button
              className="text-[#00d4a0] hover:underline"
              onClick={() => {
                onFilter({});
                setSearch("");
              }}
              type="button"
            >
              Clear all
            </button>
          </div>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border border-b bg-muted/50 text-left text-muted-foreground text-xs uppercase tracking-wide">
                <th className="px-4 py-3 font-medium">Outcome</th>
                <th className="px-4 py-3 font-medium">Event</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">
                  Repo
                </th>
                <th className="hidden px-4 py-3 font-medium lg:table-cell">
                  PR
                </th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">
                  Sender
                </th>
                <th className="px-4 py-3 font-medium">Received</th>
                <th className="hidden px-4 py-3 font-medium lg:table-cell">
                  Run
                </th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr
                      className="border-border border-b last:border-0"
                      // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length skeleton rows have no stable id.
                      key={`skel-${i}`}
                    >
                      {Array.from({ length: 7 }).map((__, j) => (
                        <td
                          className="px-4 py-3"
                          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length skeleton cells have no stable id.
                          key={`skel-${i}-${j}`}
                        >
                          <div className="h-4 animate-pulse rounded bg-muted" />
                        </td>
                      ))}
                    </tr>
                  ))
                : null}
              {!loading && events.length === 0 ? (
                <tr>
                  <td
                    className="py-16 text-center text-muted-foreground"
                    colSpan={7}
                  >
                    <Webhook className="mx-auto mb-2 size-8 opacity-40" />
                    <p className="text-sm">
                      No webhook events match these filters
                    </p>
                  </td>
                </tr>
              ) : null}
              {loading
                ? null
                : // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: breadth of independent branches/panels in one cohesive view-builder, not tangled control flow; splitting would scatter co-located UI logic
                  events.map((e) => {
                    const decoded = decodeAction(
                      e.action,
                      e.triggeredRun !== null
                    );
                    const meta = OUTCOME_META[decoded.outcome];
                    const OutcomeIcon = meta.icon;
                    return (
                      <tr
                        className="cursor-pointer border-border border-b transition-colors last:border-0 hover:bg-accent/50"
                        key={e.id}
                        onClick={() => openDetail(e.id)}
                      >
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1.5 text-xs",
                              meta.tone
                            )}
                            title={meta.label}
                          >
                            <OutcomeIcon className="size-4" />
                            <span className="hidden sm:inline">
                              {decoded.label}
                            </span>
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-mono text-xs">
                              {e.eventType}
                            </span>
                            {e.action ? (
                              <span className="text-muted-foreground text-xs">
                                {e.action}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="hidden px-4 py-3 md:table-cell">
                          <span className="font-mono text-muted-foreground text-xs">
                            {e.repoKey}
                          </span>
                        </td>
                        <td className="hidden max-w-[220px] px-4 py-3 lg:table-cell">
                          {e.prNumber ? (
                            <span className="text-xs">
                              <span className="text-muted-foreground">
                                #{e.prNumber}
                              </span>{" "}
                              {e.prTitle ? (
                                <span className="truncate">{e.prTitle}</span>
                              ) : null}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/50 text-xs">
                              —
                            </span>
                          )}
                        </td>
                        <td className="hidden px-4 py-3 md:table-cell">
                          {e.senderLogin ? (
                            <span className="inline-flex items-center gap-1 font-mono text-xs">
                              @{e.senderLogin}
                              {isBot(e.senderLogin) ? (
                                <span className="rounded bg-amber-500/15 px-1 text-[10px] text-amber-400">
                                  bot
                                </span>
                              ) : null}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/50 text-xs">
                              —
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-muted-foreground text-xs tabular-nums">
                          <span title={new Date(e.createdAt).toLocaleString()}>
                            {relativeTime(e.createdAt)}
                          </span>
                        </td>
                        <td className="hidden px-4 py-3 lg:table-cell">
                          {e.triggeredRun ? (
                            <Link
                              className="inline-flex items-center gap-1 font-mono text-[#00d4a0] text-xs hover:underline"
                              href={`/pr-runs/${encodeURIComponent(e.triggeredRun)}`}
                              onClick={(ev) => ev.stopPropagation()}
                            >
                              {e.triggeredRun.slice(-8)}
                              <ExternalLink className="size-3" />
                            </Link>
                          ) : (
                            <span className="text-muted-foreground/50 text-xs">
                              —
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 ? (
        <div className="flex items-center justify-between text-muted-foreground text-sm">
          <span className="tabular-nums">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of{" "}
            {total.toLocaleString()}
          </span>
          <div className="flex gap-2">
            <Button
              className="min-h-[44px]"
              disabled={page === 0 || isPending}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              size="sm"
              variant="outline"
            >
              <ChevronLeft className="size-4" />
              Previous
            </Button>
            <Button
              className="min-h-[44px]"
              disabled={page >= totalPages - 1 || isPending}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              size="sm"
              variant="outline"
            >
              Next
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}

      {selectedEvent ? (
        <DetailPanel
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
        />
      ) : null}
      {detailLoading ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/20">
          <Loader2 className="size-6 animate-spin text-[#00d4a0]" />
        </div>
      ) : null}
    </section>
  );
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return <RefreshCw className={cn("size-4", spinning && "animate-spin")} />;
}
