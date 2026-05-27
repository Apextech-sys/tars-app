"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Webhook } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { JsonTree } from "./json-tree";
import type { WebhookEventRow } from "./types";

export function WebhookEventCard({ event }: { event: WebhookEventRow }) {
  const [payloadOpen, setPayloadOpen] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Webhook className="size-4 text-muted-foreground" />
        <span className="font-medium text-sm">Triggering webhook event</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
        {event.deliveryId && (
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Delivery ID
            </p>
            <p className="font-mono text-xs text-muted-foreground truncate">
              {event.deliveryId}
            </p>
          </div>
        )}
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">
            Event
          </p>
          <p className="font-mono text-xs">{event.eventType}</p>
        </div>
        {event.action && (
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Action
            </p>
            <p className="font-mono text-xs">{event.action}</p>
          </div>
        )}
        {event.prTitle && (
          <div className="space-y-0.5 col-span-2 md:col-span-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              PR Title
            </p>
            <p className="text-xs truncate">{event.prTitle}</p>
          </div>
        )}
        {event.senderLogin && (
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Sender
            </p>
            <p className="text-xs font-mono">@{event.senderLogin}</p>
          </div>
        )}
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">
            Received
          </p>
          <p className="text-xs text-muted-foreground">
            {new Date(event.createdAt).toLocaleString()}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          className="text-xs min-h-[36px]"
          onClick={() => setPayloadOpen((o) => !o)}
          aria-expanded={payloadOpen}
        >
          {payloadOpen ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
          {payloadOpen ? "Hide" : "View"} raw payload
        </Button>
        <Link
          href={`/webhooks?repo=${encodeURIComponent(event.repoKey)}`}
          className="text-xs text-primary hover:underline flex items-center gap-1"
        >
          <ExternalLink className="size-3" />
          All events for this repo
        </Link>
      </div>

      {payloadOpen && (
        <div className="mt-2">
          <JsonTree data={event.rawPayload} className="max-h-80 overflow-y-auto" />
        </div>
      )}
    </div>
  );
}
