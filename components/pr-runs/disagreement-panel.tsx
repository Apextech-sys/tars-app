"use client";

import { useState, useTransition } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Scale,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { SeverityBadge } from "./status-badge";
import type { DisagreementPayload, FindingItem } from "./types";

function extractFindings(payload: DisagreementPayload, reviewer: "codex" | "claude"): FindingItem[] {
  const data = payload[reviewer];
  if (!data) return [];
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
      <p className="text-sm text-muted-foreground italic py-4">No findings reported.</p>
    );
  }

  return (
    <div className="space-y-2">
      {findings.map((f, i) => {
        const norm = normalizeFinding(f);
        const isExpanded = expandedIdx === i;
        return (
          <div
            key={`${norm.filePath}-${norm.line}-${i}`}
            className="rounded-md border border-border bg-card/50"
          >
            <button
              type="button"
              className="w-full text-left flex items-start gap-2 p-3 min-h-[44px]"
              aria-expanded={isExpanded}
              onClick={() => setExpandedIdx(isExpanded ? null : i)}
            >
              {isExpanded ? (
                <ChevronDown className="size-3.5 shrink-0 mt-0.5 text-muted-foreground" />
              ) : (
                <ChevronRight className="size-3.5 shrink-0 mt-0.5 text-muted-foreground" />
              )}
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <SeverityBadge severity={norm.severity} />
                  <code className="text-xs font-mono text-muted-foreground">
                    {norm.filePath}:{norm.line}
                  </code>
                </div>
              </div>
            </button>
            {isExpanded && (
              <div className="px-3 pb-3 pt-0 text-sm text-foreground/80 leading-relaxed border-t border-border">
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
    <div className="rounded-lg border border-border bg-card p-4 space-y-3 flex flex-col h-full">
      <div className="space-y-0.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-base">{title}</h3>
          <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
            {findings.length} finding{findings.length !== 1 ? "s" : ""}
          </span>
        </div>
        {model && (
          <p className="text-xs text-muted-foreground font-mono">{model}</p>
        )}
      </div>

      {summary && (
        <div>
          <button
            type="button"
            className="text-xs text-primary hover:underline flex items-center gap-1 min-h-[32px]"
            onClick={() => setSummaryOpen((o) => !o)}
          >
            {summaryOpen ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
            Reviewer summary
          </button>
          {summaryOpen && (
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed bg-muted/50 rounded p-3">
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
  const overlapPct = payload.overlapRatio !== undefined
    ? Math.round(payload.overlapRatio * 100)
    : null;
  const threshold = agreementThreshold ?? 0.7;
  const thresholdPct = Math.round(threshold * 100);
  const overlapBelowThreshold = overlapPct !== null && overlapPct / 100 < threshold;

  async function handleAction(action: "post-codex" | "post-claude" | "post-merged" | "dismiss") {
    startTransition(async () => {
      try {
        const res = await fetch("/api/tars/pr-review/disagreement-action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId, action }),
        });
        const data = await res.json() as { ok?: boolean; error?: string };
        if (!res.ok) {
          toast.error(data.error ?? "Action failed");
          return;
        }
        setLocalAction(action);
        toast.success(
          "Action recorded — backend posting wiring is the next slice.",
          { duration: 4000 }
        );
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
        <div className="rounded-lg border border-border bg-card p-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Finding overlap</span>
            <span
              className={cn(
                "font-mono font-semibold",
                overlapBelowThreshold ? "text-red-400" : "text-emerald-400"
              )}
            >
              {overlapPct}%
              <span className="text-muted-foreground font-normal ml-1">
                (threshold {thresholdPct}%)
              </span>
            </span>
          </div>
          <div
            className="h-2 rounded-full bg-muted overflow-hidden"
            role="progressbar"
            aria-valuenow={overlapPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Finding overlap: ${overlapPct}%`}
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
            <div className="flex items-center gap-1.5 text-xs text-red-400">
              <AlertTriangle className="size-3.5" />
              Below threshold — reviewers disagree significantly
            </div>
          )}
        </div>
      )}

      {/* Desktop: two columns; mobile: tabs */}
      <div className="hidden md:grid md:grid-cols-2 gap-4">
        <ReviewerCard
          title="Codex"
          model={payload.codex?.model}
          summary={payload.codex?.summary}
          findings={codexFindings}
        />
        <ReviewerCard
          title="Claude"
          model={payload.claude?.model}
          summary={payload.claude?.summary}
          findings={claudeFindings}
        />
      </div>

      <div className="md:hidden">
        <Tabs defaultValue="codex">
          <TabsList className="w-full">
            <TabsTrigger value="codex" className="flex-1">
              Codex
              <span className="ml-1.5 text-xs bg-muted px-1.5 py-0.5 rounded-full">
                {codexFindings.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="claude" className="flex-1">
              Claude
              <span className="ml-1.5 text-xs bg-muted px-1.5 py-0.5 rounded-full">
                {claudeFindings.length}
              </span>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="codex" className="mt-3 max-h-[60vh] overflow-y-auto">
            {payload.codex?.summary && (
              <p className="text-sm text-muted-foreground mb-3 p-3 bg-muted/50 rounded">
                {payload.codex.summary}
              </p>
            )}
            <FindingsList findings={codexFindings} />
          </TabsContent>
          <TabsContent value="claude" className="mt-3 max-h-[60vh] overflow-y-auto">
            {payload.claude?.summary && (
              <p className="text-sm text-muted-foreground mb-3 p-3 bg-muted/50 rounded">
                {payload.claude.summary}
              </p>
            )}
            <FindingsList findings={claudeFindings} />
          </TabsContent>
        </Tabs>
      </div>

      {/* Action row */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Scale className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">Adjudication</span>
          {actionDone && (
            <div className="flex items-center gap-1 text-xs text-emerald-400 ml-auto">
              <CheckCircle2 className="size-3.5" />
              {localAction} recorded
            </div>
          )}
        </div>
        {!actionDone ? (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              className="min-h-[44px]"
              onClick={() => handleAction("post-codex")}
              aria-label="Post Codex findings to PR"
            >
              {isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Post Codex findings
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              className="min-h-[44px]"
              onClick={() => handleAction("post-claude")}
              aria-label="Post Claude findings to PR"
            >
              Post Claude findings
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              className="min-h-[44px]"
              onClick={() => handleAction("post-merged")}
              aria-label="Post merged findings to PR"
            >
              Post merged
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={isPending}
              className="min-h-[44px]"
              onClick={() => handleAction("dismiss")}
              aria-label="Dismiss as noise"
            >
              Dismiss as noise
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Action &quot;{localAction}&quot; was recorded. GitHub posting is wired in the next slice.
          </p>
        )}
      </div>
    </div>
  );
}
