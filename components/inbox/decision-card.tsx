"use client";

import {
  AlertCircle,
  Clock,
  Loader2,
  Scale,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  approvalActionFromInbox,
  deferEscalation,
  type InboxItem,
  resolveEscalation,
  snoozeEscalation,
} from "@/app/inbox/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { FindingRow, findingKey, SeverityChip } from "./finding-row";
import { SourceChips } from "./source-chips";

function relativeAge(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) {
    return "just now";
  }
  if (mins < 60) {
    return `${mins}m`;
  }
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) {
    return `${hrs}h`;
  }
  return `${Math.floor(hrs / 24)}d`;
}

function CardShell({
  accent,
  children,
  selected,
  onSelectChange,
  selectable,
}: {
  accent: string;
  children: ReactNode;
  onSelectChange?: (v: boolean) => void;
  selectable?: boolean;
  selected?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative space-y-3 overflow-hidden rounded-xl border bg-card p-4",
        "before:absolute before:inset-y-0 before:left-0 before:w-1",
        accent
      )}
    >
      {selectable ? (
        <div className="absolute top-4 right-4">
          <Checkbox
            aria-label="Select for bulk action"
            checked={selected}
            onCheckedChange={(v) => onSelectChange?.(v === true)}
          />
        </div>
      ) : null}
      {children}
    </div>
  );
}

function PendingApprovalCard({
  item,
  onAction,
  onSelectChange,
  selected,
}: {
  item: Extract<InboxItem, { kind: "pr_pending_approval" }>;
  onAction: () => void;
  onSelectChange: (v: boolean) => void;
  selected: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState("");

  const act = (action: "approve" | "reject") => {
    startTransition(async () => {
      const res = await approvalActionFromInbox(
        item.runId,
        action,
        action === "reject" ? reason : undefined
      );
      if (res.ok) {
        toast.success(action === "approve" ? "Approved" : "Rejected", {
          duration: 4000,
        });
      } else {
        toast.error(res.error ?? "Action failed");
      }
      setShowReject(false);
      onAction();
    });
  };

  const critical = item.findings.filter((f) =>
    ["critical", "blocker"].includes(f.severity.toLowerCase())
  ).length;
  const accent = critical > 0 ? "before:bg-red-500" : "before:bg-sky-500";

  return (
    <CardShell
      accent={accent}
      onSelectChange={onSelectChange}
      selectable
      selected={selected}
    >
      <div className="flex flex-wrap items-center gap-2 pr-8">
        <ShieldCheck className="size-4 shrink-0 text-sky-400" />
        <span className="font-medium text-sm">Pending approval</span>
        {item.maxSeverity ? <SeverityChip severity={item.maxSeverity} /> : null}
        <span className="ml-auto text-muted-foreground text-xs tabular-nums">
          waiting {relativeAge(item.ageMs)}
        </span>
      </div>

      <SourceChips
        owner={item.owner}
        prNumber={item.prNumber}
        prSha={item.prSha}
        repo={item.repo}
        runId={item.runId}
      />

      <p className="text-muted-foreground text-xs leading-relaxed">
        Codex and Claude agreed on{" "}
        <strong className="text-foreground tabular-nums">
          {item.findingsCount}
        </strong>{" "}
        finding{item.findingsCount === 1 ? "" : "s"}
        {critical > 0 ? (
          <span className="text-red-400"> · {critical} critical</span>
        ) : null}
        . Nothing is posted or fixed until you approve.
      </p>

      {item.findings.length > 0 ? (
        <details className="group" open={critical > 0}>
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[#00d4a0] text-xs hover:underline">
            <span className="group-open:hidden">
              Show {item.findings.length} finding
              {item.findings.length === 1 ? "" : "s"}
            </span>
            <span className="hidden group-open:inline">Hide findings</span>
          </summary>
          <div className="mt-2 space-y-2">
            {item.findings.map((f) => (
              <FindingRow finding={f} key={findingKey(item.id, f)} />
            ))}
          </div>
        </details>
      ) : null}

      {item.linearIssueIdentifier && item.linearIssueUrl ? (
        <a
          className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-1 font-medium font-mono text-primary text-xs"
          href={item.linearIssueUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          {item.linearIssueIdentifier}
        </a>
      ) : null}

      {showReject ? (
        <textarea
          className="min-h-[64px] w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for rejection (optional)"
          value={reason}
        />
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          aria-label="Approve findings"
          className="min-h-[44px] bg-emerald-600 text-white hover:bg-emerald-700"
          disabled={isPending}
          onClick={() => act("approve")}
          size="sm"
        >
          {isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <ThumbsUp className="size-3.5" />
          )}
          Approve
        </Button>
        {showReject ? (
          <Button
            aria-label="Confirm rejection"
            className="min-h-[44px]"
            disabled={isPending}
            onClick={() => act("reject")}
            size="sm"
            variant="destructive"
          >
            <ThumbsDown className="size-3.5" />
            Confirm reject
          </Button>
        ) : (
          <Button
            aria-label="Reject findings"
            className="min-h-[44px]"
            disabled={isPending}
            onClick={() => setShowReject(true)}
            size="sm"
            variant="outline"
          >
            <ThumbsDown className="size-3.5" />
            Reject
          </Button>
        )}
      </div>
    </CardShell>
  );
}

function DisagreementCard({
  item,
}: {
  item: Extract<InboxItem, { kind: "pr_disagreement" }>;
}) {
  const total = item.codexFindingsCount + item.claudeFindingsCount;
  const codexPct = total > 0 ? (item.codexFindingsCount / total) * 100 : 50;
  const overlapPct =
    item.overlapRatio === null ? null : Math.round(item.overlapRatio * 100);

  return (
    <CardShell accent="before:bg-purple-500">
      <div className="flex flex-wrap items-center gap-2">
        <Scale className="size-4 shrink-0 text-purple-400" />
        <span className="font-medium text-sm">Reviewer disagreement</span>
        {item.maxSeverity ? <SeverityChip severity={item.maxSeverity} /> : null}
        <span className="ml-auto text-muted-foreground text-xs tabular-nums">
          waiting {relativeAge(item.ageMs)}
        </span>
      </div>

      <SourceChips
        owner={item.owner}
        prNumber={item.prNumber}
        prSha={item.prSha}
        repo={item.repo}
        runId={item.runId}
      />

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-[#00d4a0]">
            Codex{" "}
            <strong className="tabular-nums">{item.codexFindingsCount}</strong>
          </span>
          <span className="text-muted-foreground tabular-nums">
            {overlapPct === null ? "no overlap data" : `${overlapPct}% overlap`}
          </span>
          <span className="text-amber-400">
            Claude{" "}
            <strong className="tabular-nums">{item.claudeFindingsCount}</strong>
          </span>
        </div>
        <div className="flex h-2 overflow-hidden rounded-full bg-muted">
          <div className="bg-[#00d4a0]/70" style={{ width: `${codexPct}%` }} />
          <div className="flex-1 bg-amber-400/70" />
        </div>
      </div>

      {item.codexFindings.length > 0 || item.claudeFindings.length > 0 ? (
        <details className="group">
          <summary className="cursor-pointer list-none text-[#00d4a0] text-xs hover:underline">
            <span className="group-open:hidden">Preview both reviewers</span>
            <span className="hidden group-open:inline">Hide preview</span>
          </summary>
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <p className="font-medium text-[#00d4a0] text-xs uppercase">
                Codex
              </p>
              {item.codexFindings.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  No findings (reviewer may have errored).
                </p>
              ) : (
                item.codexFindings.map((f) => (
                  <FindingRow
                    finding={f}
                    key={findingKey(`${item.id}-cx`, f)}
                  />
                ))
              )}
            </div>
            <div className="space-y-2">
              <p className="font-medium text-amber-400 text-xs uppercase">
                Claude
              </p>
              {item.claudeFindings.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  No findings (reviewer may have errored).
                </p>
              ) : (
                item.claudeFindings.map((f) => (
                  <FindingRow
                    finding={f}
                    key={findingKey(`${item.id}-cl`, f)}
                  />
                ))
              )}
            </div>
          </div>
        </details>
      ) : null}

      <a
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border px-3 text-sm transition-colors hover:bg-accent"
        href={`/pr-runs/${encodeURIComponent(item.runId)}#disagreement`}
      >
        <Scale className="size-3.5" />
        Compare reviewers
      </a>
    </CardShell>
  );
}

function EscalationCard({
  item,
  onAction,
}: {
  item: Extract<InboxItem, { kind: "escalation" }>;
  onAction: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [showResolve, setShowResolve] = useState(false);
  const [note, setNote] = useState("");

  const run = (fn: () => Promise<void>) => {
    startTransition(async () => {
      await fn();
      setShowResolve(false);
      onAction();
    });
  };

  return (
    <CardShell accent="before:bg-red-500">
      <div className="flex flex-wrap items-center gap-2">
        <AlertCircle className="size-4 shrink-0 text-red-400" />
        <span className="font-medium text-sm">{item.title}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground uppercase">
          {item.source}
        </span>
        <span className="ml-auto text-muted-foreground text-xs tabular-nums">
          {relativeAge(item.ageMs)}
        </span>
      </div>
      {item.bodyMarkdown ? (
        <p className="whitespace-pre-wrap text-muted-foreground text-xs leading-relaxed">
          {item.bodyMarkdown.length > 320
            ? `${item.bodyMarkdown.slice(0, 320)}…`
            : item.bodyMarkdown}
        </p>
      ) : null}
      {showResolve ? (
        <textarea
          className="min-h-[64px] w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          onChange={(e) => setNote(e.target.value)}
          placeholder="Resolution note (optional)"
          value={note}
        />
      ) : null}
      <div className="flex flex-wrap gap-2">
        {showResolve ? (
          <Button
            className="min-h-[44px]"
            disabled={isPending}
            onClick={() => run(() => resolveEscalation(item.id, note))}
            size="sm"
          >
            Mark resolved
          </Button>
        ) : (
          <Button
            className="min-h-[44px]"
            disabled={isPending}
            onClick={() => setShowResolve(true)}
            size="sm"
            variant="outline"
          >
            Resolve
          </Button>
        )}
        <Button
          disabled={isPending}
          onClick={() => run(() => snoozeEscalation(item.id, 1))}
          size="sm"
          variant="ghost"
        >
          <Clock className="size-3.5" /> 1h
        </Button>
        <Button
          disabled={isPending}
          onClick={() => run(() => snoozeEscalation(item.id, 24))}
          size="sm"
          variant="ghost"
        >
          <Clock className="size-3.5" /> 24h
        </Button>
        <Button
          disabled={isPending}
          onClick={() => run(() => deferEscalation(item.id))}
          size="sm"
          variant="ghost"
        >
          <X className="size-3.5" /> Defer
        </Button>
      </div>
    </CardShell>
  );
}

export function DecisionCard({
  item,
  onAction,
  onSelectChange,
  selected,
}: {
  item: InboxItem;
  onAction: () => void;
  onSelectChange: (v: boolean) => void;
  selected: boolean;
}) {
  if (item.kind === "pr_pending_approval") {
    return (
      <PendingApprovalCard
        item={item}
        onAction={onAction}
        onSelectChange={onSelectChange}
        selected={selected}
      />
    );
  }
  if (item.kind === "pr_disagreement") {
    return <DisagreementCard item={item} />;
  }
  if (item.kind === "escalation") {
    return <EscalationCard item={item} onAction={onAction} />;
  }
  return null;
}
