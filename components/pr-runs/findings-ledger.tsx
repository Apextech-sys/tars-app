"use client";

import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { SeverityBadge } from "./status-badge";
import type { AgreedFinding, DisagreementPayload, FindingItem } from "./types";

type Source = "agreed" | "codex" | "claude";

interface LedgerFinding {
  severity: string;
  rank: number;
  location: string;
  category: string | null;
  title: string;
  body: string;
  suggestion: string | null;
  sources: Source[];
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  crit: 0,
  blocker: 0,
  high: 1,
  major: 1,
  medium: 2,
  minor: 2,
  moderate: 2,
  low: 3,
  info: 4,
  nit: 4,
};

const SEVERITY_GROUPS: { key: string; label: string; ranks: number[] }[] = [
  { key: "critical", label: "Critical", ranks: [0] },
  { key: "major", label: "Major / High", ranks: [1] },
  { key: "minor", label: "Minor / Medium", ranks: [2] },
  { key: "low", label: "Low / Info", ranks: [3, 4] },
];

function rankOf(severity: string): number {
  return SEVERITY_RANK[severity.toLowerCase()] ?? 2;
}

function locOf(
  file: string | undefined,
  line: number | string | undefined
): string {
  const f = file ?? "unknown";
  return line ? `${f}:${line}` : f;
}

function fromAgreed(f: AgreedFinding): LedgerFinding {
  const severity = String(f.severity ?? "minor");
  return {
    severity,
    rank: rankOf(severity),
    location: locOf(f.file, f.line),
    category: f.category ?? null,
    title: f.message ?? "(no detail)",
    body: "",
    suggestion: f.suggestion ?? null,
    sources: ["agreed"],
  };
}

function fromReviewer(f: FindingItem, source: Source): LedgerFinding {
  const severity = String(f.severity ?? "minor");
  const title =
    typeof (f as { title?: string }).title === "string"
      ? ((f as { title?: string }).title as string)
      : (f.message ?? f.description ?? "(no detail)");
  const body =
    (f as { detail?: string }).detail ?? f.message ?? f.description ?? "";
  return {
    severity,
    rank: rankOf(severity),
    location: locOf(f.file ?? f.filePath, f.line ?? f.lineNumber),
    category: null,
    title,
    body,
    suggestion: f.suggestion ?? null,
    sources: [source],
  };
}

function dedupeKey(f: LedgerFinding): string {
  return `${f.location}::${f.title.slice(0, 60)}`;
}

function buildLedger(
  agreed: AgreedFinding[],
  payload: DisagreementPayload | null
): LedgerFinding[] {
  const byKey = new Map<string, LedgerFinding>();
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: breadth of independent branches/panels in one cohesive view-builder, not tangled control flow; splitting would scatter co-located UI logic
  const push = (f: LedgerFinding) => {
    const key = dedupeKey(f);
    const existing = byKey.get(key);
    if (existing) {
      for (const s of f.sources) {
        if (!existing.sources.includes(s)) {
          existing.sources.push(s);
        }
      }
      if (!existing.body && f.body) {
        existing.body = f.body;
      }
      if (!existing.suggestion && f.suggestion) {
        existing.suggestion = f.suggestion;
      }
      return;
    }
    byKey.set(key, f);
  };

  for (const f of agreed) {
    push(fromAgreed(f));
  }
  for (const f of payload?.codex?.findings ?? []) {
    push(fromReviewer(f, "codex"));
  }
  for (const f of payload?.claude?.findings ?? []) {
    push(fromReviewer(f, "claude"));
  }
  return [...byKey.values()].sort((a, b) => a.rank - b.rank);
}

const SOURCE_BADGE: Record<Source, string> = {
  agreed: "border-[#00d4a0]/30 bg-[#00d4a0]/10 text-[#00d4a0]",
  codex: "border-sky-500/30 bg-sky-500/10 text-sky-400",
  claude: "border-violet-500/30 bg-violet-500/10 text-violet-300",
};

const SOURCE_LABEL: Record<Source, string> = {
  agreed: "Agreed",
  codex: "Codex",
  claude: "Claude",
};

function SourceBadge({ source }: { source: Source }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
        SOURCE_BADGE[source]
      )}
    >
      {SOURCE_LABEL[source]}
    </span>
  );
}

function FindingRow({ finding }: { finding: LedgerFinding }) {
  const [open, setOpen] = useState(false);
  const expandable = Boolean(finding.body || finding.suggestion);
  return (
    <div className="rounded-lg border bg-background/40">
      <button
        aria-expanded={open}
        className="flex min-h-[44px] w-full items-start gap-2 p-3 text-left"
        disabled={!expandable}
        onClick={() => setOpen((o) => !o)}
        type="button"
      >
        {expandable ? (
          <span className="mt-0.5 shrink-0 text-muted-foreground">
            {open ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </span>
        ) : (
          <span className="mt-0.5 size-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 space-y-1.5">
          <span className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={finding.severity} />
            <code className="break-all font-mono text-[11px] text-muted-foreground">
              {finding.location}
            </code>
            {finding.category ? (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {finding.category}
              </span>
            ) : null}
            <span className="ml-auto flex items-center gap-1">
              {finding.sources.map((s) => (
                <SourceBadge key={s} source={s} />
              ))}
            </span>
          </span>
          <span className="block text-foreground/90 text-sm leading-snug">
            {finding.title}
          </span>
        </span>
      </button>
      {open && expandable ? (
        <div className="space-y-2 border-t px-3 pt-2 pb-3">
          {finding.body ? (
            <p className="whitespace-pre-wrap text-muted-foreground text-xs leading-relaxed">
              {finding.body}
            </p>
          ) : null}
          {finding.suggestion ? (
            <div>
              <p className="mb-0.5 font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
                Suggested fix
              </p>
              <p className="whitespace-pre-wrap text-foreground/80 text-xs leading-relaxed">
                {finding.suggestion}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface FindingsLedgerProps {
  agreedFindings: AgreedFinding[];
  disagreedPayload: DisagreementPayload | null;
}

export function FindingsLedger({
  agreedFindings,
  disagreedPayload,
}: FindingsLedgerProps) {
  const ledger = buildLedger(agreedFindings, disagreedPayload);

  if (ledger.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl border bg-card p-4 text-muted-foreground text-sm">
        <FileText className="size-4" />
        No findings recorded for this run.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {SEVERITY_GROUPS.map((group) => {
        const items = ledger.filter((f) => group.ranks.includes(f.rank));
        if (items.length === 0) {
          return null;
        }
        const isCritical = group.key === "critical";
        return (
          <details className="group" key={group.key} open={isCritical}>
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg border bg-card px-3 py-2">
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
              <span
                className={cn(
                  "size-2 rounded-full",
                  isCritical ? "bg-red-500" : "bg-muted-foreground/50"
                )}
              />
              <span className="font-medium text-sm">{group.label}</span>
              <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs tabular-nums">
                {items.length}
              </span>
            </summary>
            <div className="mt-2 space-y-2 pl-1">
              {items.map((f, i) => (
                <FindingRow
                  finding={f}
                  // biome-ignore lint/suspicious/noArrayIndexKey: list items can legitimately repeat (same location/title); composite key includes index to guarantee React key uniqueness
                  key={`${group.key}-${f.location}-${i}`}
                />
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}
