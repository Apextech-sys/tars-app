"use client";

import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  XCircle,
} from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { SeverityBadge } from "./status-badge";
import type { AgreedFinding } from "./types";

interface ApprovalPanelProps {
  runId: string;
  findings: AgreedFinding[];
  /** Mirrors the run status — "pending-approval" | "approved" | "rejected". */
  status: string;
  approvalAction: string | null;
  approvalReason: string | null;
  linearIssueIdentifier: string | null;
  linearIssueUrl: string | null;
  /** Optional internal secret passed through to the API (Tailscale guard). */
  authToken?: string;
}

type Decision = "pending" | "approved" | "rejected";

function toDecision(status: string): Decision {
  if (status === "approved") {
    return "approved";
  }
  if (status === "rejected") {
    return "rejected";
  }
  return "pending";
}

function findingKey(finding: AgreedFinding, index: number): string {
  const file = finding.file ?? "x";
  const line = finding.line ?? "n";
  const msg = (finding.message ?? "").slice(0, 24);
  return `${file}-${line}-${msg}-${index}`;
}

function bannerClass(decision: Decision): string {
  if (decision === "approved") {
    return "border-emerald-500/30 bg-emerald-500/5";
  }
  if (decision === "rejected") {
    return "border-rose-500/30 bg-rose-500/5";
  }
  return "border-sky-500/30 bg-sky-500/5";
}

const BANNER_TITLE: Record<Decision, string> = {
  approved: "Approved — fix stage authorized",
  rejected: "Rejected",
  pending: "Awaiting your approval",
};

const BANNER_BODY: Record<Decision, string> = {
  approved:
    "Codex and Claude agreed on these findings and you approved them. The fix stage (Slice 2) will pick this run up.",
  rejected: "You rejected these findings. Nothing will be written to the PR.",
  pending:
    "Codex and Claude agreed on the findings below. Nothing is posted to GitHub or fixed until you approve.",
};

function BannerIcon({ decision }: { decision: Decision }) {
  if (decision === "approved") {
    return <ThumbsUp className="mt-0.5 size-4 shrink-0 text-emerald-400" />;
  }
  if (decision === "rejected") {
    return <ThumbsDown className="mt-0.5 size-4 shrink-0 text-rose-400" />;
  }
  return <ShieldCheck className="mt-0.5 size-4 shrink-0 text-sky-400" />;
}

function ApprovalBanner({
  decision,
  reason,
}: {
  decision: Decision;
  reason: string | null;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border p-4",
        bannerClass(decision)
      )}
    >
      <BannerIcon decision={decision} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium text-sm">{BANNER_TITLE[decision]}</p>
        <p className="text-muted-foreground text-xs leading-relaxed">
          {BANNER_BODY[decision]}
        </p>
        {decision === "rejected" && reason && (
          <p className="mt-1 rounded bg-muted/50 p-2 text-muted-foreground text-xs">
            Reason: {reason}
          </p>
        )}
      </div>
    </div>
  );
}

function FindingRow({ finding }: { finding: AgreedFinding }) {
  const [open, setOpen] = useState(false);
  const file = finding.file ?? "unknown";
  const line = finding.line ? `:${finding.line}` : "";
  const severity = finding.severity ?? "minor";
  const message = finding.message ?? "(no detail)";
  const hasSuggestion = Boolean(finding.suggestion);

  return (
    <div className="rounded-md border border-border bg-card/50">
      <button
        aria-expanded={open}
        className="flex min-h-[44px] w-full items-start gap-2 p-3 text-left"
        onClick={() => setOpen((o) => !o)}
        type="button"
      >
        {open ? (
          <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={severity} />
            <code className="break-all font-mono text-muted-foreground text-xs">
              {file}
              {line}
            </code>
          </div>
          <p className="text-foreground/90 text-sm leading-relaxed">
            {message}
          </p>
        </div>
      </button>
      {open && hasSuggestion && (
        <div className="border-border border-t px-3 pt-2 pb-3">
          <p className="mb-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
            Suggested fix
          </p>
          <p className="whitespace-pre-wrap text-foreground/80 text-sm leading-relaxed">
            {finding.suggestion}
          </p>
        </div>
      )}
    </div>
  );
}

function LinearLink({
  identifier,
  url,
}: {
  identifier: string | null;
  url: string;
}) {
  return (
    <a
      aria-label={`Open Linear issue ${identifier ?? ""}`}
      className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm transition-colors hover:bg-accent/50"
      href={url}
      rel="noopener noreferrer"
      target="_blank"
    >
      <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium font-mono text-primary text-xs">
        {identifier ?? "Linear"}
      </span>
      <span className="text-muted-foreground">View Linear issue</span>
      <ExternalLink className="size-3.5 text-muted-foreground" />
    </a>
  );
}

function FindingsCard({ findings }: { findings: AgreedFinding[] }) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Agreed findings</h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs">
          {findings.length} finding{findings.length === 1 ? "" : "s"}
        </span>
      </div>
      {findings.length === 0 ? (
        <p className="py-4 text-muted-foreground text-sm italic">
          No agreed findings recorded on this run.
        </p>
      ) : (
        <div className="space-y-2">
          {findings.map((f, i) => (
            <FindingRow finding={f} key={findingKey(f, i)} />
          ))}
        </div>
      )}
    </div>
  );
}

function linearNoteFrom(linear?: {
  ok?: boolean;
  stateName?: string;
  error?: string;
}): string {
  if (linear?.ok) {
    return ` · Linear -> ${linear.stateName}`;
  }
  if (linear?.error) {
    return " · Linear update failed (will retry)";
  }
  return "";
}

interface ApprovalResponse {
  ok?: boolean;
  error?: string;
  status?: string;
  linear?: { ok?: boolean; stateName?: string; error?: string };
}

async function postApprovalAction(args: {
  runId: string;
  action: "approve" | "reject";
  reason?: string;
  authToken?: string;
}): Promise<ApprovalResponse> {
  const res = await fetch("/api/tars/pr-review/approval-action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      runId: args.runId,
      action: args.action,
      reason: args.reason,
      ...(args.authToken ? { authToken: args.authToken } : {}),
    }),
  });
  const data = (await res.json()) as ApprovalResponse;
  return { ...data, ok: res.ok && data.ok };
}

export function ApprovalPanel({
  runId,
  findings,
  status,
  approvalAction,
  approvalReason,
  linearIssueIdentifier,
  linearIssueUrl,
  authToken,
}: ApprovalPanelProps) {
  const [isPending, startTransition] = useTransition();
  const [localStatus, setLocalStatus] = useState(status);
  const [localAction, setLocalAction] = useState(approvalAction);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState(approvalReason ?? "");

  const decision = toDecision(localStatus);
  const decided = decision !== "pending";

  function submit(action: "approve" | "reject", reason?: string) {
    startTransition(async () => {
      try {
        const data = await postApprovalAction({
          runId,
          action,
          reason,
          authToken,
        });
        if (!data.ok) {
          toast.error(data.error ?? "Action failed");
          return;
        }
        const fallback = action === "approve" ? "approved" : "rejected";
        setLocalStatus(data.status ?? fallback);
        setLocalAction(action);
        setRejectOpen(false);
        const note = linearNoteFrom(data.linear);
        const msg =
          action === "approve"
            ? `Approved — fix stage authorized${note}`
            : `Rejected${note}`;
        toast.success(msg, { duration: 5000 });
      } catch {
        toast.error("Network error — try again");
      }
    });
  }

  return (
    <div className="space-y-4" id="approval">
      <ApprovalBanner decision={decision} reason={approvalReason} />

      {linearIssueUrl && (
        <LinearLink identifier={linearIssueIdentifier} url={linearIssueUrl} />
      )}

      <FindingsCard findings={findings} />

      {/* Action row */}
      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-muted-foreground" />
          <span className="font-medium text-sm">Decision</span>
          {decided && (
            <div
              className={cn(
                "ml-auto flex items-center gap-1 text-xs",
                decision === "approved" ? "text-emerald-400" : "text-rose-400"
              )}
            >
              {decision === "approved" ? (
                <CheckCircle2 className="size-3.5" />
              ) : (
                <XCircle className="size-3.5" />
              )}
              {localAction} recorded
            </div>
          )}
        </div>
        {decided ? (
          <p className="text-muted-foreground text-xs">
            This run has been {localStatus}. Buttons are disabled to prevent a
            double decision.
          </p>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              aria-label="Approve findings"
              className="min-h-[44px] flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={isPending}
              onClick={() => submit("approve")}
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ThumbsUp className="size-4" />
              )}
              Approve
            </Button>
            <Button
              aria-label="Reject findings"
              className="min-h-[44px] flex-1"
              disabled={isPending}
              onClick={() => setRejectOpen(true)}
              variant="outline"
            >
              <ThumbsDown className="size-4" />
              Reject
            </Button>
          </div>
        )}
      </div>

      {/* Reject reason dialog */}
      <Dialog onOpenChange={setRejectOpen} open={rejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject findings</DialogTitle>
            <DialogDescription>
              Add an optional reason. The linked Linear issue will be moved to
              Canceled.
            </DialogDescription>
          </DialogHeader>
          <textarea
            className="min-h-[80px] w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Reason (optional) — e.g. out of scope, false positive"
            value={rejectReason}
          />
          <DialogFooter>
            <Button
              className="min-h-[44px]"
              onClick={() => setRejectOpen(false)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              className="min-h-[44px]"
              disabled={isPending}
              onClick={() => submit("reject", rejectReason || undefined)}
              variant="destructive"
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ThumbsDown className="size-4" />
              )}
              Confirm reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
