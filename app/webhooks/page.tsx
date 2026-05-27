"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { JsonTree } from "@/components/pr-runs/json-tree";
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
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
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
      role="dialog"
      aria-modal="true"
      aria-label={`Webhook event ${event.deliveryId ?? event.id}`}
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-4"
    >
      <div
        className="absolute inset-0 bg-black/50"
        aria-hidden="true"
        onClick={onClose}
      />
      <div className="relative w-full max-w-2xl max-h-[90vh] bg-background border border-border rounded-t-xl md:rounded-xl shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Webhook className="size-4 text-muted-foreground" />
            <span className="font-medium text-sm">
              {event.eventType}
              {event.action ? ` / ${event.action}` : ""}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-muted-foreground hover:text-foreground rounded-md hover:bg-accent"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Meta */}
        <div className="px-4 py-3 border-b border-border shrink-0 space-y-2">
          <div className="grid grid-cols-2 gap-3 text-sm">
            {event.deliveryId && (
              <div>
                <p className="text-xs text-muted-foreground">Delivery ID</p>
                <p className="font-mono text-xs truncate">{event.deliveryId}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground">Repo</p>
              <p className="font-mono text-xs">{event.repoKey}</p>
            </div>
            {event.prTitle && (
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground">PR Title</p>
                <p className="text-xs">{event.prTitle}</p>
              </div>
            )}
            {event.senderLogin && (
              <div>
                <p className="text-xs text-muted-foreground">Sender</p>
                <p className="font-mono text-xs">@{event.senderLogin}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground">Received</p>
              <p className="text-xs">{new Date(event.createdAt).toLocaleString()}</p>
            </div>
            {event.triggeredRun && (
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground">Triggered run</p>
                <Link
                  href={`/pr-runs/${encodeURIComponent(event.triggeredRun)}`}
                  className="text-xs text-primary hover:underline flex items-center gap-1 font-mono"
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
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">
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
  const [selectedEvent, setSelectedEvent] = useState<WebhookDetail | null>(null);
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
          if (repo) params.set("repo", repo);
          if (event) params.set("event", event);
          if (action) params.set("action", action);
          params.set("limit", String(PAGE_SIZE));
          params.set("offset", String(p * PAGE_SIZE));

          const res = await fetch(`/api/tars/webhooks?${params.toString()}`);
          const data = await res.json() as { events: WebhookRow[]; total: number };
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
      const data = await res.json() as WebhookDetail;
      setSelectedEvent(data);
    } finally {
      setDetailLoading(false);
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-6 md:py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Webhooks</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {total.toLocaleString()} event{total !== 1 ? "s" : ""} received
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="min-h-[44px]"
            onClick={() => load(repoFilter, eventFilter, actionFilter, page)}
            disabled={isPending}
          >
            <RefreshCw className={cn("size-4", isPending && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {/* Filters */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap gap-3">
            <Input
              placeholder="owner/repo"
              className="w-full sm:w-48"
              value={repoFilter}
              onChange={(e) => {
                setRepoFilter(e.target.value);
                setPage(0);
              }}
            />
            <Input
              placeholder="Event type (e.g. pull_request)"
              className="w-full sm:w-56"
              value={eventFilter}
              onChange={(e) => {
                setEventFilter(e.target.value);
                setPage(0);
              }}
            />
            <Input
              placeholder="Action (e.g. opened)"
              className="w-full sm:w-40"
              value={actionFilter}
              onChange={(e) => {
                setActionFilter(e.target.value);
                setPage(0);
              }}
            />
          </div>
        </div>

        {/* Events list */}
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Event
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Repo
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide hidden md:table-cell">
                    PR
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide hidden md:table-cell">
                    Sender
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Received
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide hidden lg:table-cell">
                    Run
                  </th>
                  <th className="px-4 py-3 w-12" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={`skel-${i}`} className="border-b border-border last:border-0">
                      {Array.from({ length: 7 }).map((__, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 bg-muted animate-pulse rounded" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : events.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-16 text-muted-foreground">
                      <Webhook className="size-8 mx-auto opacity-40 mb-2" />
                      <p className="text-sm">No webhook events match these filters</p>
                    </td>
                  </tr>
                ) : (
                  events.map((e) => (
                    <tr
                      key={e.id}
                      className="border-b border-border last:border-0 hover:bg-accent/50 transition-colors cursor-pointer"
                      onClick={() => openDetail(e.id)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-mono text-xs">{e.eventType}</span>
                          {e.action && (
                            <span className="text-xs text-muted-foreground">
                              {e.action}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-muted-foreground">
                          {e.repoKey}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        {e.prNumber ? (
                          <span className="text-xs">#{e.prNumber}</span>
                        ) : (
                          <span className="text-xs text-zinc-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        {e.senderLogin ? (
                          <span className="font-mono text-xs">@{e.senderLogin}</span>
                        ) : (
                          <span className="text-xs text-zinc-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {relativeTime(e.createdAt)}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {e.triggeredRun ? (
                          <Link
                            href={`/pr-runs/${encodeURIComponent(e.triggeredRun)}`}
                            className="text-xs text-primary hover:underline flex items-center gap-1 font-mono"
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
                        <span className="text-xs text-primary hover:underline">
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
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)}{" "}
              of {total}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="min-h-[44px]"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0 || isPending}
              >
                <ChevronLeft className="size-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="min-h-[44px]"
                onClick={() =>
                  setPage((p) => Math.min(totalPages - 1, p + 1))
                }
                disabled={page >= totalPages - 1 || isPending}
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
        <DetailPanel event={selectedEvent} onClose={() => setSelectedEvent(null)} />
      )}
      {detailLoading && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/20">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      )}
    </div>
  );
}
