"use client";

import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  RefreshCw,
  Webhook,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";
import { JsonTree } from "@/components/pr-runs/json-tree";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

function relativeTime(iso: string): string {
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

function DetailPanel({
  event,
  onClose,
}: {
  event: WebhookDetail;
  onClose: () => void;
}) {
  return (
    <div
      aria-label={`Webhook event ${event.deliveryId ?? event.id}`}
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end justify-center p-0 md:items-center md:p-4"
      role="dialog"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col rounded-t-xl border border-border bg-background shadow-2xl md:rounded-xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-border border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Webhook className="size-4 text-muted-foreground" />
            <span className="font-medium text-sm">
              {event.eventType}
              {event.action ? ` / ${event.action}` : ""}
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

        {/* Meta */}
        <div className="shrink-0 space-y-2 border-border border-b px-4 py-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            {event.deliveryId && (
              <div>
                <p className="text-muted-foreground text-xs">Delivery ID</p>
                <p className="truncate font-mono text-xs">{event.deliveryId}</p>
              </div>
            )}
            <div>
              <p className="text-muted-foreground text-xs">Repo</p>
              <p className="font-mono text-xs">{event.repoKey}</p>
            </div>
            {event.prTitle && (
              <div className="col-span-2">
                <p className="text-muted-foreground text-xs">PR Title</p>
                <p className="text-xs">{event.prTitle}</p>
              </div>
            )}
            {event.senderLogin && (
              <div>
                <p className="text-muted-foreground text-xs">Sender</p>
                <p className="font-mono text-xs">@{event.senderLogin}</p>
              </div>
            )}
            <div>
              <p className="text-muted-foreground text-xs">Received</p>
              <p className="text-xs">
                {new Date(event.createdAt).toLocaleString()}
              </p>
            </div>
            {event.triggeredRun && (
              <div className="col-span-2">
                <p className="text-muted-foreground text-xs">Triggered run</p>
                <Link
                  className="flex items-center gap-1 font-mono text-primary text-xs hover:underline"
                  href={`/pr-runs/${encodeURIComponent(event.triggeredRun)}`}
                >
                  {event.triggeredRun}
                  <ExternalLink className="size-3" />
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Raw payload */}
        <div className="flex-1 overflow-y-auto p-4">
          <p className="mb-2 text-muted-foreground text-xs uppercase tracking-wide">
            Raw Payload
          </p>
          <JsonTree data={event.rawPayload} />
        </div>
      </div>
    </div>
  );
}

export default function WebhooksPage() {
  const [events, setEvents] = useState<WebhookRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [selectedEvent, setSelectedEvent] = useState<WebhookDetail | null>(
    null
  );
  const [detailLoading, setDetailLoading] = useState(false);

  // Filters
  const [repoFilter, setRepoFilter] = useState("");
  const [eventFilter, setEventFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");

  const load = useCallback(
    (repo: string, event: string, action: string, p: number) => {
      startTransition(async () => {
        setLoading(true);
        try {
          const params = new URLSearchParams();
          if (repo) {
            params.set("repo", repo);
          }
          if (event) {
            params.set("event", event);
          }
          if (action) {
            params.set("action", action);
          }
          params.set("limit", String(PAGE_SIZE));
          params.set("offset", String(p * PAGE_SIZE));

          const res = await fetch(`/api/tars/webhooks?${params.toString()}`);
          const data = (await res.json()) as {
            events: WebhookRow[];
            total: number;
          };
          setEvents(data.events);
          setTotal(data.total);
        } finally {
          setLoading(false);
        }
      });
    },
    []
  );

  useEffect(() => {
    load(repoFilter, eventFilter, actionFilter, page);
  }, [load, repoFilter, eventFilter, actionFilter, page]);

  async function openDetail(id: number) {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/tars/webhooks/${id}`);
      const data = (await res.json()) as WebhookDetail;
      setSelectedEvent(data);
    } finally {
      setDetailLoading(false);
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 md:py-8">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-bold text-2xl">Webhooks</h1>
            <p className="mt-1 text-muted-foreground text-sm">
              {total.toLocaleString()} event{total === 1 ? "" : "s"} received
            </p>
          </div>
          <Button
            className="min-h-[44px]"
            disabled={isPending}
            onClick={() => load(repoFilter, eventFilter, actionFilter, page)}
            size="sm"
            variant="outline"
          >
            <RefreshCw className={cn("size-4", isPending && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {/* Filters */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap gap-3">
            <Input
              className="w-full sm:w-48"
              onChange={(e) => {
                setRepoFilter(e.target.value);
                setPage(0);
              }}
              placeholder="owner/repo"
              value={repoFilter}
            />
            <Input
              className="w-full sm:w-56"
              onChange={(e) => {
                setEventFilter(e.target.value);
                setPage(0);
              }}
              placeholder="Event type (e.g. pull_request)"
              value={eventFilter}
            />
            <Input
              className="w-full sm:w-40"
              onChange={(e) => {
                setActionFilter(e.target.value);
                setPage(0);
              }}
              placeholder="Action (e.g. opened)"
              value={actionFilter}
            />
          </div>
        </div>

        {/* Events list */}
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border border-b bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">
                    Event
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">
                    Repo
                  </th>
                  <th className="hidden px-4 py-3 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide md:table-cell">
                    PR
                  </th>
                  <th className="hidden px-4 py-3 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide md:table-cell">
                    Sender
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide">
                    Received
                  </th>
                  <th className="hidden px-4 py-3 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide lg:table-cell">
                    Run
                  </th>
                  <th className="w-12 px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr
                      className="border-border border-b last:border-0"
                      key={`skel-${i}`}
                    >
                      {Array.from({ length: 7 }).map((__, j) => (
                        <td className="px-4 py-3" key={j}>
                          <div className="h-4 animate-pulse rounded bg-muted" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : events.length === 0 ? (
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
                ) : (
                  events.map((e) => (
                    <tr
                      className="cursor-pointer border-border border-b transition-colors last:border-0 hover:bg-accent/50"
                      key={e.id}
                      onClick={() => openDetail(e.id)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-mono text-xs">
                            {e.eventType}
                          </span>
                          {e.action && (
                            <span className="text-muted-foreground text-xs">
                              {e.action}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-muted-foreground text-xs">
                          {e.repoKey}
                        </span>
                      </td>
                      <td className="hidden px-4 py-3 md:table-cell">
                        {e.prNumber ? (
                          <span className="text-xs">#{e.prNumber}</span>
                        ) : (
                          <span className="text-xs text-zinc-600">—</span>
                        )}
                      </td>
                      <td className="hidden px-4 py-3 md:table-cell">
                        {e.senderLogin ? (
                          <span className="font-mono text-xs">
                            @{e.senderLogin}
                          </span>
                        ) : (
                          <span className="text-xs text-zinc-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="whitespace-nowrap text-muted-foreground text-xs">
                          {relativeTime(e.createdAt)}
                        </span>
                      </td>
                      <td className="hidden px-4 py-3 lg:table-cell">
                        {e.triggeredRun ? (
                          <Link
                            className="flex items-center gap-1 font-mono text-primary text-xs hover:underline"
                            href={`/pr-runs/${encodeURIComponent(e.triggeredRun)}`}
                            onClick={(ev) => ev.stopPropagation()}
                          >
                            {e.triggeredRun.slice(-8)}
                            <ExternalLink className="size-3" />
                          </Link>
                        ) : (
                          <span className="text-xs text-zinc-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-primary text-xs hover:underline">
                          View
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-muted-foreground text-sm">
            <span>
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)}{" "}
              of {total}
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
        )}
      </div>

      {/* Detail panel */}
      {selectedEvent && (
        <DetailPanel
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
        />
      )}
      {detailLoading && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/20">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      )}
    </div>
  );
}
