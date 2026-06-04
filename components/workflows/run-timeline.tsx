import { Boxes, ChevronRight } from "lucide-react";
import type { TimelineJob, TimelineStep } from "@/lib/tars/workflows";
import { cn } from "@/lib/utils";
import { formatDuration, statusMeta, stepDot } from "./shared";

function StepData({ data }: { data: unknown }) {
  if (data === null || data === undefined) {
    return null;
  }
  let json: string;
  try {
    json = JSON.stringify(data, null, 2);
  } catch {
    json = String(data);
  }
  if (json === "{}" || json === "null") {
    return null;
  }
  return (
    <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-muted/40 p-2 font-mono text-[11px] text-muted-foreground leading-relaxed">
      {json}
    </pre>
  );
}

const JOB_STATUS_TEXT: Record<string, string> = {
  done: "text-[#00d4a0]",
  running: "text-blue-400",
  queued: "text-sky-400",
  failed: "text-red-400",
  cancelled: "text-zinc-400",
};

function JobRow({ job }: { job: TimelineJob }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-muted/20 px-2.5 py-1.5 text-xs">
      <Boxes className="size-3.5 text-muted-foreground" />
      <span className="font-mono">{job.kind}</span>
      <span className={cn("capitalize", JOB_STATUS_TEXT[job.status])}>
        {job.status}
      </span>
      <span className="ml-auto flex items-center gap-2 text-muted-foreground tabular-nums">
        <span>{formatDuration(job.durationMs)}</span>
        {job.attempts > 1 ? <span>· {job.attempts} tries</span> : null}
      </span>
    </div>
  );
}

export function RunTimeline({
  steps,
  jobs,
}: {
  steps: TimelineStep[];
  jobs: TimelineJob[];
}) {
  if (steps.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-6 text-center text-muted-foreground text-sm">
        No durable step events recorded for this run yet.
      </div>
    );
  }
  // Group jobs by the step they most plausibly belong to (review jobs under the
  // debate stage). Since jobs are not run-linked in current data, we surface
  // any that exist beneath the review steps and otherwise list them at the end.
  const reviewJobs = jobs.filter(
    (j) =>
      j.kind.includes("review") ||
      j.kind.includes("claude") ||
      j.kind.includes("codex")
  );

  return (
    <ol className="relative space-y-1 border-zinc-800 border-l pl-6">
      {steps.map((step) => {
        const meta = statusMeta(step.status);
        const isDebate = step.step === "debate";
        return (
          <li className="relative" key={`${step.step}-${step.startedAt}`}>
            <span
              className={cn(
                "absolute top-2.5 -left-[1.95rem] size-2.5 rounded-full ring-4 ring-background",
                stepDot(step.status)
              )}
            />
            <details className="group rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/30">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-sm">
                <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
                <span className="font-mono">{step.step}</span>
                <span
                  className={cn(
                    "rounded-full border px-1.5 py-0 text-[10px]",
                    meta.cls
                  )}
                >
                  {step.status}
                </span>
                <span className="ml-auto text-muted-foreground text-xs tabular-nums">
                  {formatDuration(step.durationMs)}
                </span>
              </summary>
              <div className="mt-1 pl-5">
                {step.message ? (
                  <p className="text-muted-foreground text-xs">
                    {step.message}
                  </p>
                ) : null}
                {isDebate && reviewJobs.length > 0 ? (
                  <div className="mt-2 space-y-1">
                    {reviewJobs.map((j) => (
                      <JobRow job={j} key={j.id} />
                    ))}
                  </div>
                ) : null}
                <StepData data={step.data} />
              </div>
            </details>
          </li>
        );
      })}
      {jobs.length > 0 && reviewJobs.length === 0 ? (
        <li className="relative">
          <span className="absolute top-2.5 -left-[1.95rem] size-2.5 rounded-full bg-zinc-600 ring-4 ring-background" />
          <div className="px-2 py-1.5">
            <div className="mb-1 text-muted-foreground text-xs uppercase tracking-wide">
              Dispatched jobs
            </div>
            <div className="space-y-1">
              {jobs.map((j) => (
                <JobRow job={j} key={j.id} />
              ))}
            </div>
          </div>
        </li>
      ) : null}
    </ol>
  );
}
