import {
  Archive,
  BookOpen,
  GitBranch,
  GitPullRequest,
  type LucideIcon,
  MessageSquare,
  Wrench,
} from "lucide-react";

/** Run status -> label + chip classes. Shared across the /workflows surfaces. */
export const STATUS_META: Record<string, { label: string; cls: string }> = {
  started: {
    label: "Running",
    cls: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  },
  "pending-approval": {
    label: "Awaiting approval",
    cls: "bg-sky-500/10 text-sky-400 border-sky-500/30",
  },
  approved: {
    label: "Approved",
    cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  },
  rejected: {
    label: "Rejected",
    cls: "bg-rose-500/10 text-rose-400 border-rose-500/30",
  },
  completed: {
    label: "Completed",
    cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  },
  done: {
    label: "Done",
    cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  },
  "skipped-no-findings": {
    label: "Clean",
    cls: "bg-zinc-500/10 text-zinc-400 border-zinc-700",
  },
  "skipped-policy": {
    label: "Skipped",
    cls: "bg-zinc-500/10 text-zinc-400 border-zinc-700",
  },
  "blocked-konverge": {
    label: "Blocked",
    cls: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  },
  disagreed: {
    label: "Disagreed",
    cls: "bg-purple-500/10 text-purple-400 border-purple-500/30",
  },
  fixing: {
    label: "Fixing",
    cls: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",
  },
  "fix-in-review": {
    label: "Fix in review",
    cls: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",
  },
  "fix-failed": {
    label: "Fix failed",
    cls: "bg-rose-500/10 text-rose-400 border-rose-500/30",
  },
  error: {
    label: "Error",
    cls: "bg-rose-500/10 text-rose-400 border-rose-500/30",
  },
};

export function statusMeta(s: string): { label: string; cls: string } {
  return (
    STATUS_META[s] ?? {
      label: s,
      cls: "bg-zinc-500/10 text-zinc-400 border-zinc-700",
    }
  );
}

/** Audit step status -> dot color. */
export const STEP_STATUS_DOT: Record<string, string> = {
  ok: "bg-[#00d4a0]",
  start: "bg-blue-400 animate-pulse",
  info: "bg-sky-400",
  skip: "bg-zinc-600",
  error: "bg-red-500",
};

export function stepDot(status: string): string {
  return STEP_STATUS_DOT[status] ?? "bg-zinc-600";
}

const WORKFLOW_ICONS: Record<string, LucideIcon> = {
  GitPullRequest,
  Wrench,
  BookOpen,
  Archive,
  MessageSquare,
  GitBranch,
};

export function workflowIcon(name: string): LucideIcon {
  return WORKFLOW_ICONS[name] ?? GitBranch;
}

export function relativeTime(iso: string | number): string {
  const then = typeof iso === "number" ? iso : new Date(iso).getTime();
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 60) {
    return `${s}s ago`;
  }
  const m = Math.round(s / 60);
  if (m < 60) {
    return `${m}m ago`;
  }
  const h = Math.round(m / 60);
  if (h < 24) {
    return `${h}h ago`;
  }
  return `${Math.round(h / 24)}d ago`;
}

export function ageFromMs(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) {
    return `${s}s`;
  }
  const m = Math.round(s / 60);
  if (m < 60) {
    return `${m}m`;
  }
  const h = Math.round(m / 60);
  if (h < 24) {
    return `${h}h`;
  }
  return `${Math.round(h / 24)}d`;
}

export function formatDuration(ms: number | null): string {
  if (ms === null || ms <= 0) {
    return "—";
  }
  const s = Math.round(ms / 1000);
  if (s < 60) {
    return `${s}s`;
  }
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) {
    return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
  }
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return `${h}h ${remM}m`;
}
