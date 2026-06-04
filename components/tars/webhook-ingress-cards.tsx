"use client";

import { ShieldCheck, Wrench } from "lucide-react";
import { relativeTime } from "@/lib/tars/webhook-helpers";
import type { IngressRepo } from "@/lib/tars/webhooks-stats";
import { cn } from "@/lib/utils";
import type { WebhookFilter } from "./webhook-hero-band";

const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

function healthOf(repo: IngressRepo): {
  dot: string;
  label: string;
  tone: string;
} {
  if (!repo.webhookEnabled) {
    return {
      dot: "bg-muted-foreground/50",
      label: "Disabled",
      tone: "text-muted-foreground",
    };
  }
  const age = repo.lastEventAt
    ? Date.now() - new Date(repo.lastEventAt).getTime()
    : Number.POSITIVE_INFINITY;
  if (age > STALE_AFTER_MS) {
    return {
      dot: "bg-amber-500",
      label: "Quiet (7d+)",
      tone: "text-amber-400",
    };
  }
  return { dot: "bg-[#00d4a0]", label: "Active", tone: "text-[#00d4a0]" };
}

export function WebhookIngressCards({
  repos,
  onFilter,
}: {
  repos: IngressRepo[];
  onFilter: (filter: WebhookFilter) => void;
}) {
  if (repos.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-6 text-muted-foreground text-sm">
        No configured ingress repos. Webhook deliveries are still recorded, but
        no repo_settings rows exist to describe policy.
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {repos.map((repo) => {
        const health = healthOf(repo);
        const FixIcon = repo.autoFix ? Wrench : ShieldCheck;
        return (
          <div className="rounded-xl border bg-card p-4" key={repo.repoKey}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className={cn("size-2.5 rounded-full", health.dot)} />
                <span className="break-all font-mono text-sm">
                  {repo.repoKey}
                </span>
              </div>
              <span
                className={cn(
                  "shrink-0 whitespace-nowrap text-xs",
                  health.tone
                )}
              >
                {health.label}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs",
                  repo.autoFix
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                    : "border-[#00d4a0]/30 bg-[#00d4a0]/10 text-[#00d4a0]"
                )}
              >
                <FixIcon className="size-3" />
                {repo.autoFix ? "Auto-fix" : "Review-only"}
              </span>
              {repo.githubHookId === null ? (
                <span
                  className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-muted-foreground text-xs"
                  title="GitHub hook id not recorded — GitHub-side delivery health unavailable"
                >
                  hook id not recorded
                </span>
              ) : null}
            </div>

            {repo.notes ? (
              <p className="mt-3 text-muted-foreground text-xs leading-relaxed">
                {repo.notes}
              </p>
            ) : null}

            <div className="mt-3 grid grid-cols-3 gap-2 border-border border-t pt-3 text-xs">
              <div>
                <div className="text-muted-foreground">Events 7d</div>
                <div className="font-medium tabular-nums">
                  {repo.count7d.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Triggered</div>
                <div className="font-medium tabular-nums">
                  {repo.triggered7d.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Last event</div>
                <div className="font-medium">
                  {relativeTime(repo.lastEventAt)}
                </div>
              </div>
            </div>

            <button
              className="mt-3 w-full rounded-md border border-border py-1.5 text-muted-foreground text-xs transition-colors hover:border-[#00d4a0]/40 hover:text-foreground"
              onClick={() => onFilter({ repo: repo.repoKey })}
              type="button"
            >
              View this repo&apos;s events
            </button>
          </div>
        );
      })}
    </div>
  );
}
