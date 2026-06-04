import { Lightbulb } from "lucide-react";
import type { InboxFinding } from "@/app/inbox/actions";
import { cn } from "@/lib/utils";

const SEVERITY_STYLE: Record<string, { dot: string; chip: string }> = {
  critical: {
    dot: "bg-red-500",
    chip: "border-red-500/30 bg-red-500/10 text-red-400",
  },
  blocker: {
    dot: "bg-red-500",
    chip: "border-red-500/30 bg-red-500/10 text-red-400",
  },
  high: {
    dot: "bg-orange-500",
    chip: "border-orange-500/30 bg-orange-500/10 text-orange-400",
  },
  major: {
    dot: "bg-amber-500",
    chip: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  },
  medium: {
    dot: "bg-amber-500",
    chip: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  },
  minor: {
    dot: "bg-sky-500",
    chip: "border-sky-500/30 bg-sky-500/10 text-sky-400",
  },
  low: {
    dot: "bg-sky-500",
    chip: "border-sky-500/30 bg-sky-500/10 text-sky-400",
  },
  info: {
    dot: "bg-muted-foreground/50",
    chip: "border-border bg-muted/40 text-muted-foreground",
  },
};

function styleFor(severity: string) {
  return SEVERITY_STYLE[severity.toLowerCase()] ?? SEVERITY_STYLE.info;
}

/** Stable React key derived from a finding's content (no array index). */
export function findingKey(prefix: string, finding: InboxFinding): string {
  return `${prefix}:${finding.file ?? "?"}:${finding.line ?? "?"}:${finding.severity}:${finding.message.slice(0, 32)}`;
}

export function SeverityChip({ severity }: { severity: string }) {
  const s = styleFor(severity);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium text-[10px] uppercase tracking-wide",
        s.chip
      )}
    >
      <span className={cn("size-1.5 rounded-full", s.dot)} />
      {severity}
    </span>
  );
}

export function FindingRow({
  finding,
  reviewer,
}: {
  finding: InboxFinding;
  reviewer?: string;
}) {
  const location = finding.file
    ? `${finding.file}${finding.line ? `:${finding.line}` : ""}`
    : null;
  return (
    <div className="rounded-lg border bg-background/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityChip severity={finding.severity} />
        {reviewer ? (
          <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-[10px] text-muted-foreground uppercase">
            {reviewer}
          </span>
        ) : null}
        {finding.category ? (
          <span className="text-muted-foreground text-xs">
            {finding.category}
          </span>
        ) : null}
        {location ? (
          <span className="truncate font-mono text-muted-foreground text-xs">
            {location}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-foreground text-sm leading-relaxed">
        {finding.message}
      </p>
      {finding.suggestion ? (
        <div className="mt-2 flex items-start gap-1.5 rounded-md bg-[#00d4a0]/5 px-2.5 py-2 text-[#00d4a0]/90 text-xs leading-relaxed">
          <Lightbulb className="mt-0.5 size-3.5 shrink-0" />
          <span>{finding.suggestion}</span>
        </div>
      ) : null}
    </div>
  );
}
