import { cn } from "@/lib/utils";
import type { RunStatus } from "./types";

const STATUS_CONFIG: Record<RunStatus, { label: string; className: string }> = {
  started: {
    label: "In Progress",
    className: "bg-blue-500/10 text-blue-400 border border-blue-500/30",
  },
  completed: {
    label: "Completed",
    className:
      "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30",
  },
  "skipped-no-findings": {
    label: "No Findings",
    className: "bg-zinc-500/10 text-zinc-400 border border-zinc-500/30",
  },
  "skipped-policy": {
    label: "Skipped (Policy)",
    className: "bg-zinc-500/10 text-zinc-400 border border-zinc-500/30",
  },
  "blocked-konverge": {
    label: "Blocked (Konverge)",
    className: "bg-amber-500/10 text-amber-400 border border-amber-500/30",
  },
  disagreed: {
    label: "Disagreed",
    className: "bg-purple-500/10 text-purple-400 border border-purple-500/30",
  },
  error: {
    label: "Error",
    className: "bg-red-500/10 text-red-400 border border-red-500/30",
  },
};

export function RunStatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const config = STATUS_CONFIG[status as RunStatus] ?? {
    label: status,
    className: "bg-zinc-500/10 text-zinc-400 border border-zinc-500/30",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 font-medium text-xs uppercase tracking-wide",
        config.className,
        className
      )}
    >
      {config.label}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    CRITICAL: "bg-red-500/10 text-red-400 border border-red-500/30",
    MAJOR: "bg-orange-500/10 text-orange-400 border border-orange-500/30",
    MINOR: "bg-yellow-500/10 text-yellow-400 border border-yellow-500/30",
  };
  const cls =
    map[severity.toUpperCase()] ??
    "bg-zinc-500/10 text-zinc-400 border border-zinc-500/30";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 font-medium font-mono text-xs uppercase",
        cls
      )}
    >
      {severity}
    </span>
  );
}
