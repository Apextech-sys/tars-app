"use client";

import { BarChart3, Clock, GitBranch } from "lucide-react";
import type { AuditBucket } from "../actions";

const NUM = new Intl.NumberFormat("en-US");

function hourLabel(bucket: string): string {
  // bucket = "YYYY-MM-DD HH:00"
  return bucket.slice(11, 13);
}

function BarRow({
  label,
  count,
  max,
  active,
  onClick,
}: {
  label: string;
  count: number;
  max: number;
  active: boolean;
  onClick?: () => void;
}) {
  const pct = Math.max(2, (count / max) * 100);
  const fill = active ? "bg-[#00d4a0]" : "bg-[#00d4a0]/50";
  const content = (
    <>
      <span className="w-32 shrink-0 truncate text-left text-xs">{label}</span>
      <span className="relative h-4 flex-1 overflow-hidden rounded bg-muted/40">
        <span
          className={`absolute inset-y-0 left-0 rounded ${fill}`}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="w-12 shrink-0 text-right font-mono text-muted-foreground text-xs tabular-nums">
        {NUM.format(count)}
      </span>
    </>
  );
  if (onClick) {
    return (
      <button
        className={`flex w-full items-center gap-2 rounded px-1 py-0.5 transition-colors hover:bg-accent/40 ${active ? "bg-accent/30" : ""}`}
        onClick={onClick}
        type="button"
      >
        {content}
      </button>
    );
  }
  return (
    <div className="flex w-full items-center gap-2 px-1 py-0.5">{content}</div>
  );
}

export function ActivityBreakdowns({
  byHour,
  byRepo,
  byStep,
  selectedRepos,
  selectedSteps,
  onToggleRepo,
  onToggleStep,
}: {
  byHour: AuditBucket[];
  byRepo: AuditBucket[];
  byStep: AuditBucket[];
  selectedRepos: string[];
  selectedSteps: string[];
  onToggleRepo: (repo: string) => void;
  onToggleStep: (step: string) => void;
}) {
  const maxHour = Math.max(1, ...byHour.map((b) => b.count));
  const maxRepo = Math.max(1, ...byRepo.map((b) => b.count));
  const maxStep = Math.max(1, ...byStep.map((b) => b.count));
  const topSteps = byStep.slice(0, 6);
  const restSteps = byStep.slice(6);

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
          <Clock className="size-4" /> Actions per hour · 24h
        </div>
        {byHour.length === 0 ? (
          <p className="mt-4 text-muted-foreground text-xs">
            No activity in the last 24h.
          </p>
        ) : (
          <div className="mt-4 flex h-24 items-end gap-1">
            {byHour.map((b) => (
              <div
                className="flex flex-1 flex-col items-center gap-1"
                key={b.label}
              >
                <div
                  className="w-full rounded-t bg-[#00d4a0]/70"
                  style={{
                    height: `${Math.max(4, (b.count / maxHour) * 100)}%`,
                  }}
                  title={`${b.label} · ${b.count} actions`}
                />
                <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                  {hourLabel(b.label)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
          <GitBranch className="size-4" /> By repository
        </div>
        <div className="mt-3 space-y-1">
          {byRepo.map((b) => (
            <BarRow
              active={selectedRepos.includes(b.label)}
              count={b.count}
              key={b.label}
              label={b.label}
              max={maxRepo}
              onClick={
                b.label === "—" ? undefined : () => onToggleRepo(b.label)
              }
            />
          ))}
        </div>
      </div>

      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
          <BarChart3 className="size-4" /> By step
        </div>
        <div className="mt-3 space-y-1">
          {topSteps.map((b) => (
            <BarRow
              active={selectedSteps.includes(b.label)}
              count={b.count}
              key={b.label}
              label={b.label}
              max={maxStep}
              onClick={() => onToggleStep(b.label)}
            />
          ))}
        </div>
        {restSteps.length > 0 ? (
          <details className="mt-2">
            <summary className="cursor-pointer list-none text-[#00d4a0] text-xs hover:underline">
              show all {byStep.length} steps
            </summary>
            <div className="mt-2 space-y-1">
              {restSteps.map((b) => (
                <BarRow
                  active={selectedSteps.includes(b.label)}
                  count={b.count}
                  key={b.label}
                  label={b.label}
                  max={maxStep}
                  onClick={() => onToggleStep(b.label)}
                />
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </div>
  );
}
