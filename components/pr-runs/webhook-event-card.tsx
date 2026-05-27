"use client";

import { ChevronDown, ChevronRight, ExternalLink, Webhook } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { JsonTree } from "./json-tree";
import type { WebhookEventRow } from "./types";

export function WebhookEventCard({ event }: { event: WebhookEventRow }) {
  const [payloadOpen, setPayloadOpen] = useState(false);

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <Webhook className="size-4 text-muted-foreground" />
        <span className="font-medium text-sm">Triggering webhook event</span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
        {event.deliveryId && (
          <div className="space-y-0.5">
            <p className="text-muted-foreground text-xs uppercase tracking-wide">
              Delivery ID
            </p>
            <p className="truncate font-mono text-muted-foreground text-xs">
              {event.deliveryId}
            </p>
          </div>
        )}
        <div className="space-y-0.5">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">
            Event
          </p>
          <p className="font-mono text-xs">{event.eventType}</p>
        </div>
        {event.action && (
          <div className="space-y-0.5">
            <p className="text-muted-foreground text-xs uppercase tracking-wide">
              Action
            </p>
            <p className="font-mono text-xs">{event.action}</p>
          </div>
        )}
        {event.prTitle && (
          <div className="col-span-2 space-y-0.5 md:col-span-1">
            <p className="text-muted-foreground text-xs uppercase tracking-wide">
              PR Title
            </p>
            <p className="truncate text-xs">{event.prTitle}</p>
          </div>
        )}
        {event.senderLogin && (
          <div className="space-y-0.5">
            <p className="text-muted-foreground text-xs uppercase tracking-wide">
              Sender
            </p>
            <p className="font-mono text-xs">@{event.senderLogin}</p>
          </div>
        )}
        <div className="space-y-0.5">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">
            Received
          </p>
          <p className="text-muted-foreground text-xs">
            {new Date(event.createdAt).toLocaleString()}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          aria-expanded={payloadOpen}
          className="min-h-[36px] text-xs"
          onClick={() => setPayloadOpen((o) => !o)}
          size="sm"
          variant="ghost"
        >
          {payloadOpen ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
          {payloadOpen ? "Hide" : "View"} raw payload
        </Button>
        <Link
          className="flex items-center gap-1 text-primary text-xs hover:underline"
          href={`/webhooks?repo=${encodeURIComponent(event.repoKey)}`}
        >
          <ExternalLink className="size-3" />
          All events for this repo
        </Link>
      </div>

      {payloadOpen && (
        <div className="mt-2">
          <JsonTree
            className="max-h-80 overflow-y-auto"
            data={event.rawPayload}
          />
        </div>
      )}
    </div>
  );
}
