"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Info,
  RefreshCw,
  Timer,
  X,
  Zap,
} from "lucide-react";
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  type InboxItem,
  deferEscalation,
  fetchInboxItems,
  resolveEscalation,
  snoozeEscalation,
} from "./actions";
import { NotificationPermissionBanner } from "@/components/tars/notification-permission-banner";
import { useNotifications } from "@/hooks/use-notifications";

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
  if (kind === "escalation")
    return <AlertCircle className="size-4 text-orange-500" />;
  if (kind === "workflow_stall")
    return <Timer className="size-4 text-yellow-500" />;
  if (kind === "worker_failure") return <Zap className="size-4 text-red-500" />;
  return <AlertTriangle className="size-4 text-red-500" />;
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
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
    if (item.kind !== "escalation") return;
    startTransition(async () => {
      await resolveEscalation(item.id, resolveNote);
      setResolveOpen(false);
      onAction();
    });
  };

  const handleSnooze = (hours: number) => {
    if (item.kind !== "escalation") return;
    startTransition(async () => {
      await snoozeEscalation(item.id, hours);
      onAction();
    });
  };

  const handleDefer = () => {
    if (item.kind !== "escalation") return;
    startTransition(async () => {
      await deferEscalation(item.id);
      onAction();
    });
  };

  const isEscalation = item.kind === "escalation";

  let title = "";
  if (item.kind === "escalation") title = item.title;
  else if (item.kind === "workflow_stall")
    title = `Stalled workflow: ${item.repo} #${item.prNumber}`;
  else if (item.kind === "worker_failure")
    title = `Worker failure: ${item.jobKind}`;
  else title = `PR review failed: ${item.repo} #${item.prNumber}`;

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          {itemKindIcon(item.kind)}
          <span className="font-medium text-sm truncate">{title}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {isEscalation &&
            severityBadge(
              (item as Extract<InboxItem, { kind: "escalation" }>).severity,
            )}
          <span className="text-xs text-muted-foreground">
            {relativeTime(item.createdAt)}
          </span>
        </div>
      </div>

      {item.kind === "escalation" && item.bodyMarkdown && (
        <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
          {item.bodyMarkdown.length > 300
            ? `${item.bodyMarkdown.slice(0, 300)}...`
            : item.bodyMarkdown}
        </p>
      )}

      {item.kind === "worker_failure" && item.errorText && (
        <p className="text-xs text-red-500 font-mono bg-muted rounded px-2 py-1 truncate">
          {item.errorText}
        </p>
      )}

      {item.kind === "pr_failure" && (
        <p className="text-xs text-red-500 font-mono bg-muted rounded px-2 py-1 truncate">
          {item.error}
        </p>
      )}

      {isEscalation && (
        <div className="flex gap-2 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            className="min-h-[44px]"
            onClick={() => setResolveOpen(true)}
          >
            <CheckCircle2 className="size-3.5" />
            Resolve
          </Button>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => handleSnooze(1)}
                >
                  <Clock className="size-3.5" />
                  Snooze 1h
                </Button>
              </TooltipTrigger>
              <TooltipContent>Hide for 1 hour</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Button
            size="sm"
            variant="ghost"
            disabled={isPending}
            onClick={() => handleSnooze(24)}
          >
            <Clock className="size-3.5" />
            Snooze 24h
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={isPending}
            className="min-h-[44px]"
            onClick={handleDefer}
          >
            <X className="size-3.5" />
            Defer
          </Button>
        </div>
      )}

      <Dialog open={resolveOpen} onOpenChange={setResolveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve escalation</DialogTitle>
            <DialogDescription>
              Add an optional resolution note before closing this item.
            </DialogDescription>
          </DialogHeader>
          <textarea
            className="w-full rounded-md border bg-background px-3 py-2 text-sm min-h-[80px] focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Resolution note (optional)"
            value={resolveNote}
            onChange={(e) => setResolveNote(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveOpen(false)}>
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

  const tabItems: Record<string, InboxItem[]> = {
    all: items,
    stalls,
    workers: workerFails,
    escalations: escalationItems,
  };
  const filtered = tabItems[tab] ?? items;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-6 md:py-8 space-y-5 md:space-y-6">
        <NotificationPermissionBanner onRequest={promptPermission} />
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Inbox</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {items.length} item{items.length !== 1 ? "s" : ""} needing
              attention
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={isPending || loading}
            className="min-h-[44px]"
          >
            <RefreshCw className={cn("size-4", isPending && "animate-spin")} />
            Refresh
          </Button>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="all">
              All
              {items.length > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-1.5 h-5 px-1.5 text-xs"
                >
                  {items.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="stalls">
              Workflow stalls
              {stalls.length > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-1.5 h-5 px-1.5 text-xs"
                >
                  {stalls.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="workers">
              Worker failures
              {workerFails.length > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-1.5 h-5 px-1.5 text-xs"
                >
                  {workerFails.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="escalations">
              Escalations
              {escalationItems.length > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-1.5 h-5 px-1.5 text-xs"
                >
                  {escalationItems.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {["all", "stalls", "workers", "escalations"].map((t) => (
            <TabsContent key={t} value={t} className="space-y-3 mt-4">
              {loading ? (
                <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
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
                  <InboxCard key={item.id} item={item} onAction={refresh} />
                ))
              )}
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
}
