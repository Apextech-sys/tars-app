"use client";

import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Info,
  RefreshCw,
  Scale,
  Timer,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { NotificationPermissionBanner } from "@/components/tars/notification-permission-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useNotifications } from "@/hooks/use-notifications";
import { cn } from "@/lib/utils";
import {
  deferEscalation,
  fetchInboxItems,
  type InboxItem,
  resolveEscalation,
  snoozeEscalation,
} from "./actions";

function severityBadge(severity: string) {
  const map: Record<
    string,
    {
      label: string;
      variant: "default" | "warning" | "destructive" | "secondary";
    }
  > = {
    info: { label: "Info", variant: "secondary" },
    warn: { label: "Warning", variant: "warning" },
    blocker: { label: "Blocker", variant: "destructive" },
  };
  const cfg = map[severity] ?? { label: severity, variant: "secondary" };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

function itemKindIcon(kind: InboxItem["kind"]) {
  if (kind === "escalation") {
    return <AlertCircle className="size-4 text-orange-500" />;
  }
  if (kind === "workflow_stall") {
    return <Timer className="size-4 text-yellow-500" />;
  }
  if (kind === "worker_failure") {
    return <Zap className="size-4 text-red-500" />;
  }
  if (kind === "pr_disagreement") {
    return <Scale className="size-4 text-purple-500" />;
  }
  return <AlertTriangle className="size-4 text-red-500" />;
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) {
    return "just now";
  }
  if (mins < 60) {
    return `${mins}m ago`;
  }
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) {
    return `${hrs}h ago`;
  }
  return `${Math.floor(hrs / 24)}d ago`;
}

function InboxCard({
  item,
  onAction,
}: {
  item: InboxItem;
  onAction: () => void;
}) {
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveNote, setResolveNote] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleResolve = () => {
    if (item.kind !== "escalation") {
      return;
    }
    startTransition(async () => {
      await resolveEscalation(item.id, resolveNote);
      setResolveOpen(false);
      onAction();
    });
  };

  const handleSnooze = (hours: number) => {
    if (item.kind !== "escalation") {
      return;
    }
    startTransition(async () => {
      await snoozeEscalation(item.id, hours);
      onAction();
    });
  };

  const handleDefer = () => {
    if (item.kind !== "escalation") {
      return;
    }
    startTransition(async () => {
      await deferEscalation(item.id);
      onAction();
    });
  };

  const isEscalation = item.kind === "escalation";
  const _isDisagreement = item.kind === "pr_disagreement";

  // For pr_disagreement: navigate to run detail page instead of showing modal
  const handleInspect = () => {
    if (item.kind !== "pr_disagreement") {
      return;
    }
    window.location.href = `/pr-runs/${encodeURIComponent(item.runId)}#disagreement`;
  };

  let title = "";
  if (item.kind === "escalation") {
    title = item.title;
  } else if (item.kind === "workflow_stall") {
    title = `Stalled workflow: ${item.repo} #${item.prNumber}`;
  } else if (item.kind === "worker_failure") {
    title = `Worker failure: ${item.jobKind}`;
  } else if (item.kind === "pr_disagreement") {
    title = `Reviewer disagreement: ${item.repo} #${item.prNumber}`;
  } else {
    title = `PR review failed: ${item.repo} #${item.prNumber}`;
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {itemKindIcon(item.kind)}
          <span className="truncate font-medium text-sm">{title}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {isEscalation &&
            severityBadge(
              (item as Extract<InboxItem, { kind: "escalation" }>).severity
            )}
          <span className="text-muted-foreground text-xs">
            {relativeTime(item.createdAt)}
          </span>
        </div>
      </div>

      {item.kind === "escalation" && item.bodyMarkdown && (
        <p className="whitespace-pre-wrap text-muted-foreground text-xs leading-relaxed">
          {item.bodyMarkdown.length > 300
            ? `${item.bodyMarkdown.slice(0, 300)}...`
            : item.bodyMarkdown}
        </p>
      )}

      {item.kind === "worker_failure" && item.errorText && (
        <p className="truncate rounded bg-muted px-2 py-1 font-mono text-red-500 text-xs">
          {item.errorText}
        </p>
      )}

      {item.kind === "pr_failure" && (
        <p className="truncate rounded bg-muted px-2 py-1 font-mono text-red-500 text-xs">
          {item.error}
        </p>
      )}

      {item.kind === "pr_disagreement" && (
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs leading-relaxed">
            Codex and Claude produced divergent findings on this PR. No public
            comment was posted. Compare both raw outputs to decide.
          </p>
          <div className="flex flex-wrap gap-3 text-xs">
            <span className="rounded bg-muted px-2 py-1">
              Codex: <strong>{item.codexFindingsCount}</strong>
            </span>
            <span className="rounded bg-muted px-2 py-1">
              Claude: <strong>{item.claudeFindingsCount}</strong>
            </span>
            {item.overlapRatio !== null && (
              <span className="rounded bg-muted px-2 py-1">
                Overlap:{" "}
                <strong>{(item.overlapRatio * 100).toFixed(0)}%</strong>
              </span>
            )}
            {item.prSha && (
              <span className="rounded bg-muted px-2 py-1 font-mono">
                {item.prSha.slice(0, 7)}
              </span>
            )}
          </div>
          <Button
            className="min-h-[44px]"
            disabled={isPending}
            onClick={handleInspect}
            size="sm"
            variant="outline"
          >
            <Scale className="size-3.5" />
            Compare reviewers
          </Button>
        </div>
      )}

      {/* Disagreement modal replaced: "Compare reviewers" now navigates to /pr-runs/[runId]#disagreement */}

      {isEscalation && (
        <div className="flex flex-wrap gap-2">
          <Button
            className="min-h-[44px]"
            disabled={isPending}
            onClick={() => setResolveOpen(true)}
            size="sm"
            variant="outline"
          >
            <CheckCircle2 className="size-3.5" />
            Resolve
          </Button>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  disabled={isPending}
                  onClick={() => handleSnooze(1)}
                  size="sm"
                  variant="ghost"
                >
                  <Clock className="size-3.5" />
                  Snooze 1h
                </Button>
              </TooltipTrigger>
              <TooltipContent>Hide for 1 hour</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Button
            disabled={isPending}
            onClick={() => handleSnooze(24)}
            size="sm"
            variant="ghost"
          >
            <Clock className="size-3.5" />
            Snooze 24h
          </Button>
          <Button
            className="min-h-[44px]"
            disabled={isPending}
            onClick={handleDefer}
            size="sm"
            variant="ghost"
          >
            <X className="size-3.5" />
            Defer
          </Button>
        </div>
      )}

      <Dialog onOpenChange={setResolveOpen} open={resolveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve escalation</DialogTitle>
            <DialogDescription>
              Add an optional resolution note before closing this item.
            </DialogDescription>
          </DialogHeader>
          <textarea
            className="min-h-[80px] w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            onChange={(e) => setResolveNote(e.target.value)}
            placeholder="Resolution note (optional)"
            value={resolveNote}
          />
          <DialogFooter>
            <Button onClick={() => setResolveOpen(false)} variant="outline">
              Cancel
            </Button>
            <Button disabled={isPending} onClick={handleResolve}>
              <CheckCircle2 className="size-3.5" />
              Mark resolved
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function InboxPage() {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("all");
  const { notify, promptPermission } = useNotifications();
  const eventSourceRef = useRef<EventSource | null>(null);
  const [isPending, startTransition] = useTransition();

  const refresh = useCallback(() => {
    startTransition(async () => {
      setLoading(true);
      const data = await fetchInboxItems();
      setItems(data);
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
  }, [refresh]);

  const escalationItems = items.filter((i) => i.kind === "escalation");
  const stalls = items.filter((i) => i.kind === "workflow_stall");
  const workerFails = items.filter((i) => i.kind === "worker_failure");
  const disagreements = items.filter((i) => i.kind === "pr_disagreement");

  const tabItems: Record<string, InboxItem[]> = {
    all: items,
    stalls,
    workers: workerFails,
    escalations: escalationItems,
    disagreements,
  };
  const filtered = tabItems[tab] ?? items;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl space-y-5 px-4 py-6 md:space-y-6 md:py-8">
        <NotificationPermissionBanner onRequest={promptPermission} />
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-bold text-2xl">Inbox</h1>
            <p className="mt-1 text-muted-foreground text-sm">
              {items.length} item{items.length === 1 ? "" : "s"} needing
              attention
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

        <Tabs onValueChange={setTab} value={tab}>
          <TabsList className="h-auto flex-wrap gap-1">
            <TabsTrigger value="all">
              All
              {items.length > 0 && (
                <Badge
                  className="ml-1.5 h-5 px-1.5 text-xs"
                  variant="secondary"
                >
                  {items.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="stalls">
              Workflow stalls
              {stalls.length > 0 && (
                <Badge
                  className="ml-1.5 h-5 px-1.5 text-xs"
                  variant="secondary"
                >
                  {stalls.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="workers">
              Worker failures
              {workerFails.length > 0 && (
                <Badge
                  className="ml-1.5 h-5 px-1.5 text-xs"
                  variant="secondary"
                >
                  {workerFails.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="escalations">
              Escalations
              {escalationItems.length > 0 && (
                <Badge
                  className="ml-1.5 h-5 px-1.5 text-xs"
                  variant="secondary"
                >
                  {escalationItems.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="disagreements">
              Disagreements
              {disagreements.length > 0 && (
                <Badge
                  className="ml-1.5 h-5 px-1.5 text-xs"
                  variant="secondary"
                >
                  {disagreements.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {["all", "stalls", "workers", "escalations", "disagreements"].map(
            (t) => (
              <TabsContent className="mt-4 space-y-3" key={t} value={t}>
                {loading ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                    <RefreshCw className="size-4 animate-spin" />
                    Loading...
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
                    <Info className="size-8" />
                    <p className="text-sm">No items here - all clear.</p>
                  </div>
                ) : (
                  filtered.map((item) => (
                    <InboxCard item={item} key={item.id} onAction={refresh} />
                  ))
                )}
              </TabsContent>
            )
          )}
        </Tabs>
      </div>
    </div>
  );
}
