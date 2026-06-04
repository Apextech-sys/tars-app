import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type Tone = "neutral" | "good" | "warn" | "bad";

export const TONE_ACCENT: Record<Tone, string> = {
  bad: "text-red-400",
  warn: "text-amber-400",
  good: "text-[#00d4a0]",
  neutral: "text-foreground",
};

/**
 * Mirrors the StatTile in app/infra/page.tsx so /settings shares the rebuilt
 * design system (rounded-xl border bg-card, uppercase label, 2xl tabular-nums
 * value, tone accent). Kept dependency-free so it is safe on the server shell.
 */
export function SettingsStatTile({
  icon: Icon,
  label,
  value,
  sub,
  tone = "neutral",
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
        <Icon className="size-4" /> {label}
      </div>
      <div
        className={`mt-1 font-semibold text-2xl tabular-nums ${TONE_ACCENT[tone]}`}
      >
        {value}
      </div>
      {sub ? <div className="text-muted-foreground text-xs">{sub}</div> : null}
    </div>
  );
}
