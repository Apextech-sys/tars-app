"use client";

import {
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DayBucket {
  day: string;
  count: number;
}

interface StatusCount {
  status: string;
  count: number;
}

interface RepoRow {
  repoKey: string;
  owner: string;
  repo: string;
  webhookEnabled: boolean;
  autoFix: boolean;
  hookInstalled: boolean;
  notes: string | null;
  updatedAt: string | null;
  deliveryCount: number;
  lastDeliveryAt: string | null;
  dailyBuckets: DayBucket[];
  reviewRunCount: number;
  statusCounts: StatusCount[];
}

interface PendingChange {
  webhookEnabled?: boolean;
  autoFix?: boolean;
  notes?: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  "pending-approval": "bg-sky-400",
  disagreed: "bg-purple-400",
  error: "bg-red-500",
  started: "bg-blue-400",
  "skipped-no-findings": "bg-[#00d4a0]/70",
  done: "bg-[#00d4a0]",
  fixing: "bg-amber-400",
  "fix-in-review": "bg-amber-400",
  "fix-failed": "bg-red-500",
};

function relativeTime(iso: string | null): string {
  if (!iso) {
    return "never";
  }
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return "never";
  }
  const mins = Math.floor((Date.now() - then) / 60_000);
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
  return `${Math.floor(hours / 24)}d ago`;
}

function Toggle({
  checked,
  label,
  onToggle,
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-input transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-checked:bg-[#00d4a0]"
      onClick={onToggle}
      role="switch"
      type="button"
    >
      <span className="pointer-events-none block size-5 translate-x-0 rounded-full bg-background shadow-lg transition-transform aria-checked:translate-x-5" />
    </button>
  );
}

function DeliverySparkline({ buckets }: { buckets: DayBucket[] }) {
  if (buckets.length === 0) {
    return (
      <span className="text-muted-foreground/60 text-xs">no deliveries</span>
    );
  }
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div className="flex h-8 items-end gap-0.5">
      {buckets.map((b) => (
        <div
          className="w-1.5 rounded-t bg-[#00d4a0]/70"
          key={b.day}
          style={{ height: `${Math.max(8, (b.count / max) * 100)}%` }}
          title={`${b.day}: ${b.count}`}
        />
      ))}
    </div>
  );
}

function RepoCard({
  row,
  pending,
  onToggle,
  onNotes,
}: {
  row: RepoRow;
  pending: PendingChange | undefined;
  onToggle: (field: "webhookEnabled" | "autoFix", current: boolean) => void;
  onNotes: (value: string) => void;
}) {
  const webhookEnabled = pending?.webhookEnabled ?? row.webhookEnabled;
  const autoFix = pending?.autoFix ?? row.autoFix;
  const notes = pending?.notes ?? row.notes ?? "";
  const changed = pending !== undefined && Object.keys(pending).length > 0;
  const maxStatus = Math.max(1, ...row.statusCounts.map((s) => s.count));

  return (
    <div
      className={cn(
        "rounded-xl border bg-card",
        changed && "border-amber-400/60"
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex min-w-0 items-center gap-2">
          <GitBranch className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium font-mono text-sm">
            {row.repoKey}
          </span>
          {changed ? (
            <Badge className="text-xs" variant="warning">
              unsaved
            </Badge>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-5">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">Webhook</span>
            <Toggle
              checked={webhookEnabled}
              label={`Toggle webhook for ${row.repoKey}`}
              onToggle={() => onToggle("webhookEnabled", webhookEnabled)}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">Auto-fix</span>
            <Toggle
              checked={autoFix}
              label={`Toggle auto-fix for ${row.repoKey}`}
              onToggle={() => onToggle("autoFix", autoFix)}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t px-4 py-3">
        <div>
          <div className="text-muted-foreground text-xs">Last delivery</div>
          <div className="text-sm tabular-nums">
            {relativeTime(row.lastDeliveryAt)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs">Deliveries (7d)</div>
          <DeliverySparkline buckets={row.dailyBuckets} />
        </div>
        <div>
          <div className="text-muted-foreground text-xs">Review runs</div>
          <div className="text-sm tabular-nums">{row.reviewRunCount}</div>
        </div>
      </div>

      <details className="group border-t">
        <summary className="flex cursor-pointer list-none items-center gap-1 px-4 py-2.5 text-muted-foreground text-xs hover:text-foreground">
          <span className="transition-transform group-open:rotate-90">›</span>
          Hook status · review breakdown · notes
        </summary>
        <div className="space-y-4 px-4 pb-4">
          <div className="flex items-center gap-2 text-sm">
            {row.hookInstalled ? (
              <span className="flex items-center gap-1.5 text-[#00d4a0]">
                <CheckCircle2 className="size-3.5" /> Repo webhook installed
              </span>
            ) : (
              <span className="text-muted-foreground">
                No per-repo hook — deliveries arrive via the shared org hook
              </span>
            )}
          </div>

          {row.statusCounts.length > 0 ? (
            <div className="space-y-1.5">
              {row.statusCounts.map((s) => (
                <div className="flex items-center gap-2 text-xs" key={s.status}>
                  <span className="w-36 shrink-0 text-muted-foreground">
                    {s.status}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted/50">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        STATUS_COLOR[s.status] ?? "bg-muted-foreground/50"
                      )}
                      style={{ width: `${(s.count / maxStatus) * 100}%` }}
                    />
                  </div>
                  <span className="w-6 shrink-0 text-right tabular-nums">
                    {s.count}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">
              No review runs recorded yet.
            </p>
          )}

          <div className="space-y-1.5">
            <span className="text-muted-foreground text-xs">Notes</span>
            <textarea
              className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              onChange={(e) => onNotes(e.target.value)}
              rows={2}
              value={notes}
            />
          </div>
        </div>
      </details>
    </div>
  );
}

export function ProjectsRegistrySection() {
  const [rows, setRows] = useState<RepoRow[] | null>(null);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState<Record<string, PendingChange>>({});
  const [isSaving, startSaving] = useTransition();

  useEffect(() => {
    let active = true;
    fetch("/api/settings/repos")
      .then((r) => r.json())
      .then((d: { repos: RepoRow[] }) => {
        if (active) {
          setRows(d.repos);
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

  const dirtyKeys = Object.keys(pending).filter(
    (k) => Object.keys(pending[k]).length > 0
  );

  const handleToggle = (
    repoKey: string,
    field: "webhookEnabled" | "autoFix",
    current: boolean
  ) => {
    setPending((prev) => ({
      ...prev,
      [repoKey]: { ...prev[repoKey], [field]: !current },
    }));
  };

  const handleNotes = (repoKey: string, value: string) => {
    setPending((prev) => ({
      ...prev,
      [repoKey]: { ...prev[repoKey], notes: value },
    }));
  };

  const save = () => {
    startSaving(async () => {
      try {
        await Promise.all(
          dirtyKeys.map((repoKey) =>
            fetch(`/api/settings/repos/${encodeURIComponent(repoKey)}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(pending[repoKey]),
            }).then((r) => {
              if (!r.ok) {
                throw new Error(`Failed to save ${repoKey}`);
              }
            })
          )
        );
        setRows((prev) =>
          prev
            ? prev.map((row) => {
                const change = pending[row.repoKey];
                if (!change) {
                  return row;
                }
                return { ...row, ...change };
              })
            : prev
        );
        setPending({});
        toast.success("Review controls saved");
      } catch {
        toast.error("Save failed");
      }
    });
  };

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-400 text-sm">
        <AlertTriangle className="size-4 shrink-0" />
        Could not load repository settings.
      </div>
    );
  }

  if (!rows) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div
            className="h-[120px] animate-pulse rounded-xl border bg-card"
            key={`repo-skeleton-${i}`}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-muted-foreground text-xs">
        {rows.length} repo{rows.length === 1 ? "" : "s"} under review · backed
        by the repo_settings table
      </div>
      {rows.map((row) => (
        <RepoCard
          key={row.repoKey}
          onNotes={(value) => handleNotes(row.repoKey, value)}
          onToggle={(field, current) =>
            handleToggle(row.repoKey, field, current)
          }
          pending={pending[row.repoKey]}
          row={row}
        />
      ))}

      {dirtyKeys.length > 0 ? (
        <div className="sticky bottom-4 flex items-center gap-3 rounded-xl border border-amber-400/60 bg-card px-4 py-3 shadow-lg">
          <span className="flex-1 text-amber-400 text-sm">
            {dirtyKeys.length} repo{dirtyKeys.length === 1 ? "" : "s"} with
            unsaved changes
          </span>
          <Button
            className="min-h-[44px]"
            disabled={isSaving}
            onClick={save}
            size="sm"
          >
            {isSaving ? (
              <RefreshCw className="size-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="size-3.5" />
            )}
            Save changes
          </Button>
        </div>
      ) : null}
    </div>
  );
}
