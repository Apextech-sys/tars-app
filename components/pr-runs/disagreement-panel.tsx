"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Scale,
} from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { SeverityBadge } from "./status-badge";
import type { DisagreementPayload, FindingItem } from "./types";

function extractFindings(
  payload: DisagreementPayload,
  reviewer: "codex" | "claude"
): FindingItem[] {
  const data = payload[reviewer];
  if (!data) {
    return [];
  }
  return data.findings ?? [];
}

function normalizeFinding(f: FindingItem): {
  severity: string;
  filePath: string;
  line: string;
  text: string;
} {
  return {
    severity: f.severity ?? "MINOR",
    filePath: f.file ?? f.filePath ?? "unknown",
    line: String(f.line ?? f.lineNumber ?? "?"),
    text: f.suggestion ?? f.message ?? f.description ?? "(no detail)",
  };
}

function FindingsList({ findings }: { findings: FindingItem[] }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (findings.length === 0) {
    return (
      <p className="py-4 text-muted-foreground text-sm italic">
        No findings reported.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {findings.map((f, i) => {
        const norm = normalizeFinding(f);
        const isExpanded = expandedIdx === i;
        return (
          <div
            className="rounded-md border border-border bg-card/50"
            key={`${norm.filePath}-${norm.line}-${i}`}
          >
            <button
              aria-expanded={isExpanded}
              className="flex min-h-[44px] w-full items-start gap-2 p-3 text-left"
              onClick={() => setExpandedIdx(isExpanded ? null : i)}
              type="button"
            >
              {isExpanded ? (
                <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={norm.severity} />
                  <code className="font-mono text-muted-foreground text-xs">
                    {norm.filePath}:{norm.line}
                  </code>
                </div>
              </div>
            </button>
            {isExpanded && (
              <div className="border-border border-t px-3 pt-0 pb-3 text-foreground/80 text-sm leading-relaxed">
                {norm.text}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ReviewerCard({
  title,
  model,
  summary,
  findings,
}: {
  title: string;
  model?: string;
  summary?: string;
  findings: FindingItem[];
}) {
  const [summaryOpen, setSummaryOpen] = useState(false);

  return (
    <div className="flex h-full flex-col space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="space-y-0.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-base">{title}</h3>
          <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs">
            {findings.length} finding{findings.length === 1 ? "" : "s"}
          </span>
        </div>
        {model && (
          <p className="font-mono text-muted-foreground text-xs">{model}</p>
        )}
      </div>

      {summary && (
        <div>
          <button
            className="flex min-h-[32px] items-center gap-1 text-primary text-xs hover:underline"
            onClick={() => setSummaryOpen((o) => !o)}
            type="button"
          >
            {summaryOpen ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
            Reviewer summary
          </button>
          {summaryOpen && (
            <p className="mt-2 rounded bg-muted/50 p-3 text-muted-foreground text-sm leading-relaxed">
              {summary}
            </p>
          )}
        </div>
      )}

      <div className="flex-1">
        <FindingsList findings={findings} />
      </div>
    </div>
  );
}

interface DisagreementPanelProps {
  runId: string;
  payload: DisagreementPayload;
  adjudicationAction: string | null;
  agreementThreshold?: number;
}

export function DisagreementPanel({
  runId,
  payload,
  adjudicationAction,
  agreementThreshold,
}: DisagreementPanelProps) {
  const [isPending, startTransition] = useTransition();
  const [localAction, setLocalAction] = useState(adjudicationAction);

  const codexFindings = extractFindings(payload, "codex");
  const claudeFindings = extractFindings(payload, "claude");
  const overlapPct =
    payload.overlapRatio === undefined
      ? null
      : Math.round(payload.overlapRatio * 100);
  const threshold = agreementThreshold ?? 0.7;
  const thresholdPct = Math.round(threshold * 100);
  const overlapBelowThreshold =
    overlapPct !== null && overlapPct / 100 < threshold;

  async function handleAction(
    action: "post-codex" | "post-claude" | "post-merged" | "dismiss"
  ) {
    startTransition(async () => {
      try {
        const res = await fetch("/api/tars/pr-review/disagreement-action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId, action }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          commentUrl?: string;
          findingsPosted?: number;
        };
        if (!res.ok) {
          toast.error(data.error ?? "Action failed");
          return;
        }
        // Only flip the local disabled state once the backend confirms the
        // action landed (Octokit post succeeded OR dismiss recorded).
        setLocalAction(action);
        if (action === "dismiss") {
          toast.success("Dismissed as noise.", { duration: 4000 });
        } else if (data.commentUrl) {
          const url = data.commentUrl;
          toast.success(
            `Posted ${data.findingsPosted ?? 0} finding${
              data.findingsPosted === 1 ? "" : "s"
            } to PR.`,
            {
              duration: 5000,
              action: {
                label: "View comment",
                onClick: () => window.open(url, "_blank"),
              },
            }
          );
        } else {
          toast.success("Action recorded.", { duration: 4000 });
        }
      } catch {
        toast.error("Network error — try again");
      }
    });
  }

  const actionDone = !!localAction;

  return (
    <div className="space-y-4" id="disagreement">
      {/* Overlap bar */}
      {overlapPct !== null && (
        <div className="space-y-2 rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Finding overlap</span>
            <span
              className={cn(
                "font-mono font-semibold",
                overlapBelowThreshold ? "text-red-400" : "text-emerald-400"
              )}
            >
              {overlapPct}%
              <span className="ml-1 font-normal text-muted-foreground">
                (threshold {thresholdPct}%)
              </span>
            </span>
          </div>
          <div
            aria-label={`Finding overlap: ${overlapPct}%`}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={overlapPct}
            className="h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
          >
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                overlapBelowThreshold ? "bg-red-500" : "bg-emerald-500"
              )}
              style={{ width: `${overlapPct}%` }}
            />
          </div>
          {overlapBelowThreshold && (
            <div className="flex items-center gap-1.5 text-red-400 text-xs">
              <AlertTriangle className="size-3.5" />
              Below threshold — reviewers disagree significantly
            </div>
          )}
        </div>
      )}

      {/* Desktop: two columns; mobile: tabs */}
      <div className="hidden gap-4 md:grid md:grid-cols-2">
        <ReviewerCard
          findings={codexFindings}
          model={payload.codex?.model}
          summary={payload.codex?.summary}
          title="Codex"
        />
        <ReviewerCard
          findings={claudeFindings}
          model={payload.claude?.model}
          summary={payload.claude?.summary}
          title="Claude"
        />
      </div>

      <div className="md:hidden">
        <Tabs defaultValue="codex">
          <TabsList className="w-full">
            <TabsTrigger className="flex-1" value="codex">
              Codex
              <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs">
                {codexFindings.length}
              </span>
            </TabsTrigger>
            <TabsTrigger className="flex-1" value="claude">
              Claude
              <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs">
                {claudeFindings.length}
              </span>
            </TabsTrigger>
          </TabsList>
          <TabsContent
            className="mt-3 max-h-[60vh] overflow-y-auto"
            value="codex"
          >
            {payload.codex?.summary && (
              <p className="mb-3 rounded bg-muted/50 p-3 text-muted-foreground text-sm">
                {payload.codex.summary}
              </p>
            )}
            <FindingsList findings={codexFindings} />
          </TabsContent>
          <TabsContent
            className="mt-3 max-h-[60vh] overflow-y-auto"
            value="claude"
          >
            {payload.claude?.summary && (
              <p className="mb-3 rounded bg-muted/50 p-3 text-muted-foreground text-sm">
                {payload.claude.summary}
              </p>
            )}
            <FindingsList findings={claudeFindings} />
          </TabsContent>
        </Tabs>
      </div>

      {/* Action row */}
      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <Scale className="size-4 text-muted-foreground" />
          <span className="font-medium text-sm">Adjudication</span>
          {actionDone && (
            <div className="ml-auto flex items-center gap-1 text-emerald-400 text-xs">
              <CheckCircle2 className="size-3.5" />
              {localAction} recorded
            </div>
          )}
        </div>
        {actionDone ? (
          <p className="text-muted-foreground text-xs">
            Action &quot;{localAction}&quot; was recorded. This run has been
            adjudicated and the buttons are disabled to prevent double-posting.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              aria-label="Post Codex findings to PR"
              className="min-h-[44px]"
              disabled={isPending}
              onClick={() => handleAction("post-codex")}
              size="sm"
              variant="outline"
            >
              {isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Post Codex findings
            </Button>
            <Button
              aria-label="Post Claude findings to PR"
              className="min-h-[44px]"
              disabled={isPending}
              onClick={() => handleAction("post-claude")}
              size="sm"
              variant="outline"
            >
              Post Claude findings
            </Button>
            <Button
              aria-label="Post merged findings to PR"
              className="min-h-[44px]"
              disabled={isPending}
              onClick={() => handleAction("post-merged")}
              size="sm"
              variant="outline"
            >
              Post merged
            </Button>
            <Button
              aria-label="Dismiss as noise"
              className="min-h-[44px]"
              disabled={isPending}
              onClick={() => handleAction("dismiss")}
              size="sm"
              variant="ghost"
            >
              Dismiss as noise
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
