"use client";

import { useCallback, useState } from "react";
import { WebhookBreakdown } from "@/components/tars/webhook-breakdown";
import {
  type WebhookFilter,
  WebhookHeroBand,
} from "@/components/tars/webhook-hero-band";
import { WebhookIngressCards } from "@/components/tars/webhook-ingress-cards";
import type { IngressRepo, WebhookStats } from "@/lib/tars/webhooks-stats";
import { WebhookStream } from "./webhook-stream";

function scrollToStream() {
  if (typeof document === "undefined") {
    return;
  }
  const el = document.getElementById("event-stream");
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

export function WebhookConsole({
  stats,
  ingress,
}: {
  stats: WebhookStats;
  ingress: IngressRepo[];
}) {
  const [filter, setFilter] = useState<WebhookFilter>({});

  const applyFilter = useCallback((next: WebhookFilter) => {
    setFilter((prev) => ({ ...prev, ...next }));
    scrollToStream();
  }, []);

  const replaceFilter = useCallback((next: WebhookFilter) => {
    setFilter(next);
  }, []);

  return (
    <div className="space-y-6">
      <WebhookHeroBand initialStats={stats} onFilter={applyFilter} />

      <section className="space-y-3">
        <h2 className="font-semibold text-lg">Configured ingress</h2>
        <WebhookIngressCards onFilter={applyFilter} repos={ingress} />
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold text-lg">Breakdown</h2>
        <WebhookBreakdown onFilter={applyFilter} stats={stats} />
      </section>

      <WebhookStream filter={filter} onFilter={replaceFilter} stats={stats} />
    </div>
  );
}
