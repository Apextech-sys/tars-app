"use client";

/**
 * StructuredBriefReport — THE centerpiece of the redesigned /briefs.
 *
 * Replaces the flat markdown dump with the rich structured BriefOutput
 * rendered as grouped cards:
 *   1. severity/owner breakdown (CSS bars, click-to-filter)
 *   2. insights[] as severity-colored cards (detail+citation collapsible)
 *   3. next_actions[] as owner-tagged rows (detail collapsible, link secondary)
 *   4. questions[] with reply hints
 *
 * Severity filtering is client state, so this is a "use client" component.
 * The detail page keeps the raw body_markdown behind a separate
 * "View raw report" <details> rendered with the existing Markdown component.
 */

import {
  ArrowUpRight,
  CircleDot,
  Eye,
  type LucideIcon,
  TriangleAlert,
} from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type {
  ActionOwner,
  BriefInsight,
  BriefNextAction,
  BriefQuestionItem,
  InsightSeverity,
} from "./brief-types";

interface SevStyle {
  label: string;
  dot: string;
  chip: string;
  bar: string;
  icon: LucideIcon;
}

const SEV_STYLE: Record<InsightSeverity, SevStyle> = {
  act: {
    label: "Act",
    dot: "bg-red-500",
    chip: "border-red-500/30 bg-red-500/10 text-red-400",
    bar: "bg-red-500/70",
    icon: TriangleAlert,
  },
  watch: {
    label: "Watch",
    dot: "bg-amber-500",
    chip: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    bar: "bg-amber-500/70",
    icon: Eye,
  },
  info: {
    label: "Info",
    dot: "bg-muted-foreground/50",
    chip: "border-border bg-muted/40 text-muted-foreground",
    bar: "bg-muted-foreground/40",
    icon: CircleDot,
  },
};

const SEV_ORDER: InsightSeverity[] = ["act", "watch", "info"];

const OWNER_STYLE: Record<ActionOwner, { label: string; chip: string }> = {
  shaun: {
    label: "Shaun",
    chip: "border-[#00d4a0]/30 bg-[#00d4a0]/10 text-[#00d4a0]",
  },
  tars: {
    label: "TARS",
    chip: "border-sky-500/30 bg-sky-500/10 text-sky-400",
  },
  partner: {
    label: "Partner",
    chip: "border-violet-500/30 bg-violet-500/10 text-violet-400",
  },
  deferred: {
    label: "Deferred",
    chip: "border-border bg-muted/40 text-muted-foreground",
  },
};

const OWNER_ORDER: ActionOwner[] = ["shaun", "tars", "partner", "deferred"];

function SectionHeading({
  id,
  title,
  count,
}: {
  id: string;
  title: string;
  count: number;
}) {
  return (
    <h2
      className="flex scroll-mt-20 items-center gap-2 font-semibold text-base"
      id={id}
    >
      {title}
      <span className="rounded-full border bg-muted/40 px-2 py-0.5 font-normal text-muted-foreground text-xs tabular-nums">
        {count}
      </span>
    </h2>
  );
}

function SeverityBreakdown({
  counts,
  active,
  onToggle,
}: {
  counts: Record<InsightSeverity, number>;
  active: InsightSeverity | null;
  onToggle: (s: InsightSeverity) => void;
}) {
  const total = SEV_ORDER.reduce((n, s) => n + counts[s], 0);
  if (total === 0) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex h-2.5 w-40 overflow-hidden rounded-full border bg-muted/40">
        {SEV_ORDER.map((s) => {
          const pct = (counts[s] / total) * 100;
          if (pct === 0) {
            return null;
          }
          return (
            <div
              className={SEV_STYLE[s].bar}
              key={s}
              style={{ width: `${pct}%` }}
              title={`${SEV_STYLE[s].label}: ${counts[s]}`}
            />
          );
        })}
      </div>
      {SEV_ORDER.map((s) => {
        const isActive = active === s;
        return (
          <button
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-colors",
              SEV_STYLE[s].chip,
              isActive ? "ring-1 ring-current" : "opacity-80 hover:opacity-100"
            )}
            key={s}
            onClick={() => onToggle(s)}
            type="button"
          >
            <span className={cn("size-1.5 rounded-full", SEV_STYLE[s].dot)} />
            {SEV_STYLE[s].label}
            <span className="tabular-nums">{counts[s]}</span>
          </button>
        );
      })}
    </div>
  );
}

function InsightCard({ insight }: { insight: BriefInsight }) {
  const style = SEV_STYLE[insight.severity];
  const Icon = style.icon;
  return (
    <details className="group rounded-xl border bg-card p-4 open:border-foreground/10">
      <summary className="flex cursor-pointer list-none items-start gap-3">
        <span
          className={cn(
            "mt-0.5 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
            style.chip
          )}
        >
          <Icon className="size-3" />
          {style.label}
        </span>
        <span className="flex-1 font-medium text-sm leading-snug">
          {insight.title}
        </span>
        <span className="mt-0.5 text-muted-foreground text-xs opacity-60 group-open:hidden">
          expand
        </span>
      </summary>
      <div className="mt-3 space-y-2 border-foreground/10 border-t pt-3">
        {insight.detail ? (
          <p className="text-muted-foreground text-sm leading-relaxed">
            {insight.detail}
          </p>
        ) : null}
        {insight.citation ? (
          <p className="text-muted-foreground text-xs">
            <span className="uppercase tracking-wide">source · </span>
            <span className="font-mono text-foreground/80">
              {insight.citation}
            </span>
          </p>
        ) : null}
      </div>
    </details>
  );
}

function ActionRow({ action }: { action: BriefNextAction }) {
  const style = OWNER_STYLE[action.owner];
  return (
    <details className="group rounded-xl border bg-card p-4 open:border-foreground/10">
      <summary className="flex cursor-pointer list-none items-center gap-3">
        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-0.5 text-xs",
            style.chip
          )}
        >
          {style.label}
        </span>
        <span className="flex-1 font-medium text-sm">{action.title}</span>
        {action.link ? (
          <a
            className="shrink-0 text-muted-foreground transition-colors hover:text-[#00d4a0]"
            href={action.link}
            onClick={(e) => e.stopPropagation()}
            rel="noreferrer noopener"
            target="_blank"
            title="Open linked resource"
          >
            <ArrowUpRight className="size-4" />
          </a>
        ) : null}
      </summary>
      {action.detail ? (
        <p className="mt-3 border-foreground/10 border-t pt-3 text-muted-foreground text-sm leading-relaxed">
          {action.detail}
        </p>
      ) : null}
    </details>
  );
}

function QuestionRow({ q }: { q: BriefQuestionItem }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="font-medium text-sm">{q.question}</p>
      {q.why ? (
        <p className="mt-1 text-muted-foreground text-sm leading-relaxed">
          {q.why}
        </p>
      ) : null}
      {q.reply_hint ? (
        <p className="mt-2 rounded-lg border border-[#00d4a0]/20 bg-[#00d4a0]/5 px-3 py-1.5 text-[#00d4a0] text-xs">
          Reply hint · {q.reply_hint}
        </p>
      ) : null}
    </div>
  );
}

export function StructuredBriefReport({
  summary,
  insights,
  nextActions,
  questions,
}: {
  summary: string;
  insights: BriefInsight[];
  nextActions: BriefNextAction[];
  questions: BriefQuestionItem[];
}) {
  const [sevFilter, setSevFilter] = useState<InsightSeverity | null>(null);

  const sevCounts = useMemo(() => {
    const c: Record<InsightSeverity, number> = { act: 0, watch: 0, info: 0 };
    for (const i of insights) {
      c[i.severity] += 1;
    }
    return c;
  }, [insights]);

  const ownerCounts = useMemo(() => {
    const c: Record<ActionOwner, number> = {
      shaun: 0,
      tars: 0,
      partner: 0,
      deferred: 0,
    };
    for (const a of nextActions) {
      c[a.owner] += 1;
    }
    return c;
  }, [nextActions]);

  const sortedInsights = useMemo(() => {
    const ordered = [...insights].sort(
      (a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity)
    );
    if (!sevFilter) {
      return ordered;
    }
    return ordered.filter((i) => i.severity === sevFilter);
  }, [insights, sevFilter]);

  function toggleSev(s: InsightSeverity) {
    setSevFilter((cur) => (cur === s ? null : s));
  }

  return (
    <div className="space-y-8">
      {summary ? (
        <p className="border-[#00d4a0]/40 border-l-2 pl-4 text-base text-foreground/90 leading-relaxed">
          {summary}
        </p>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionHeading
            count={insights.length}
            id="insights"
            title="Insights"
          />
          <SeverityBreakdown
            active={sevFilter}
            counts={sevCounts}
            onToggle={toggleSev}
          />
        </div>
        {sortedInsights.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-card/40 p-4 text-muted-foreground text-sm">
            {insights.length === 0
              ? "No insights in this brief."
              : "No insights match the active filter."}
          </p>
        ) : (
          <div className="grid gap-2">
            {sortedInsights.map((insight, i) => (
              <InsightCard
                insight={insight}
                // biome-ignore lint/suspicious/noArrayIndexKey: list items can legitimately repeat (same location/title); composite key includes index to guarantee React key uniqueness
                key={`${insight.severity}-${insight.title}-${i}`}
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionHeading
            count={nextActions.length}
            id="next-actions"
            title="Next actions"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            {OWNER_ORDER.filter((o) => ownerCounts[o] > 0).map((o) => (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
                  OWNER_STYLE[o].chip
                )}
                key={o}
              >
                {OWNER_STYLE[o].label}
                <span className="tabular-nums">{ownerCounts[o]}</span>
              </span>
            ))}
          </div>
        </div>
        {nextActions.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-card/40 p-4 text-muted-foreground text-sm">
            No next actions raised.
          </p>
        ) : (
          <div className="grid gap-2">
            {nextActions.map((action, i) => (
              <ActionRow
                action={action}
                // biome-ignore lint/suspicious/noArrayIndexKey: list items can legitimately repeat (same location/title); composite key includes index to guarantee React key uniqueness
                key={`${action.owner}-${action.title}-${i}`}
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <SectionHeading
          count={questions.length}
          id="questions"
          title="Questions for you"
        />
        {questions.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-card/40 p-4 text-muted-foreground text-sm">
            No open questions.
          </p>
        ) : (
          <div className="grid gap-2">
            {questions.map((q, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: list items can legitimately repeat (same location/title); composite key includes index to guarantee React key uniqueness
              <QuestionRow key={`${q.question}-${i}`} q={q} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
