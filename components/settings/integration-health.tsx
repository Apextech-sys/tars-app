"use client";

import {
  AlertTriangle,
  Bot,
  Check,
  CircleSlash,
  Cpu,
  ExternalLink,
  type LucideIcon,
  MessageSquare,
  Network,
  Server,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type IntegrationStatus = "connected" | "not-configured" | "error";

interface CredentialSlot {
  label: string;
  present: boolean;
}

interface IntegrationHealth {
  key: string;
  label: string;
  group: string;
  status: IntegrationStatus;
  detail: string;
  required: boolean;
  credentials: CredentialSlot[];
  deepLink: string | null;
  lastSyncAt: string | null;
}

interface IntegrationsResponse {
  integrations: IntegrationHealth[];
  connected: number;
  total: number;
  requiredMissing: number;
}

const GROUP_ICON: Record<string, LucideIcon> = {
  "Source control": ShieldCheck,
  Comms: MessageSquare,
  AI: Cpu,
  Knowledge: Network,
  Platform: Server,
};

const INTEGRATION_ICON: Record<string, LucideIcon> = {
  github: ShieldCheck,
  linear: ShieldCheck,
  slack: MessageSquare,
  openai: Cpu,
  graph: Network,
  worker: Bot,
  postgres: Server,
};

const GROUP_ORDER = ["Source control", "Comms", "AI", "Knowledge", "Platform"];

const STATUS_STYLE: Record<
  IntegrationStatus,
  { dot: string; label: string; text: string }
> = {
  connected: {
    dot: "bg-[#00d4a0]",
    label: "Connected",
    text: "text-[#00d4a0]",
  },
  "not-configured": {
    dot: "bg-muted-foreground/50",
    label: "Not configured",
    text: "text-muted-foreground",
  },
  error: {
    dot: "bg-red-500",
    label: "Partial",
    text: "text-red-400",
  },
};

function relativeTime(iso: string | null): string | null {
  if (!iso) {
    return null;
  }
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return null;
  }
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) {
    return "just now";
  }
  if (mins < 60) {
    return `${mins}m ago`;
  }
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function IntegrationTile({ item }: { item: IntegrationHealth }) {
  const style = STATUS_STYLE[item.status];
  const Icon = INTEGRATION_ICON[item.key] ?? Server;
  const lastSync = relativeTime(item.lastSyncAt);

  return (
    <details className="group rounded-xl border bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4">
        <Icon className="size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{item.label}</span>
            <span
              className={cn(
                "rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
                item.required
                  ? "border-border text-muted-foreground"
                  : "border-border/60 text-muted-foreground/70"
              )}
            >
              {item.required ? "Required" : "Optional"}
            </span>
          </div>
          <div className="mt-0.5 truncate text-muted-foreground text-xs">
            {item.detail}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className={cn("size-2.5 rounded-full", style.dot)} />
          <span className={cn("text-xs", style.text)}>{style.label}</span>
        </div>
      </summary>

      <div className="space-y-3 border-t px-4 py-3">
        <div className="space-y-1.5">
          {item.credentials.map((c) => (
            <div
              className="flex items-center justify-between gap-2 text-sm"
              key={c.label}
            >
              <span className="text-muted-foreground">{c.label}</span>
              {c.present ? (
                <span className="flex items-center gap-1.5 text-[#00d4a0]">
                  <span className="font-mono text-muted-foreground text-xs">
                    ••••••
                  </span>
                  <Check className="size-3.5" />
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-muted-foreground/70">
                  <CircleSlash className="size-3.5" />
                  missing
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs">
            {lastSync
              ? `Last activity ${lastSync}`
              : "No recent-activity signal"}
          </span>
          {item.deepLink ? (
            <a
              className="flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
              href={item.deepLink}
              rel="noreferrer"
              target="_blank"
            >
              Manage <ExternalLink className="size-3" />
            </a>
          ) : null}
        </div>
      </div>
    </details>
  );
}

export function IntegrationHealthSection() {
  const [data, setData] = useState<IntegrationsResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/settings/integrations")
      .then((r) => r.json())
      .then((d: IntegrationsResponse) => {
        if (active) {
          setData(d);
        }
      })
      .catch(() => {
        if (active) {
          setError(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-400 text-sm">
        <AlertTriangle className="size-4 shrink-0" />
        Could not load integration health.
      </div>
    );
  }

  if (!data) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            className="h-[68px] animate-pulse rounded-xl border bg-card"
            key={`int-skeleton-${i}`}
          />
        ))}
      </div>
    );
  }

  const grouped = new Map<string, IntegrationHealth[]>();
  for (const item of data.integrations) {
    const list = grouped.get(item.group) ?? [];
    list.push(item);
    grouped.set(item.group, list);
  }
  const groups = GROUP_ORDER.filter((g) => grouped.has(g));

  return (
    <div className="space-y-5">
      {groups.map((group) => {
        const GroupIcon = GROUP_ICON[group] ?? Server;
        const items = grouped.get(group) ?? [];
        return (
          <div className="space-y-3" key={group}>
            <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
              <GroupIcon className="size-3.5" />
              {group}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => (
                <IntegrationTile item={item} key={item.key} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
