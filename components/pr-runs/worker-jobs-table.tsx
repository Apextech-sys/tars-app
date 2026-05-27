import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { TarsJobRow } from "./types";

function statusClass(status: string): string {
  if (status === "done") {
    return "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30";
  }
  if (status === "failed" || status === "error") {
    return "bg-red-500/10 text-red-400 border border-red-500/30";
  }
  if (status === "running") {
    return "bg-blue-500/10 text-blue-400 border border-blue-500/30";
  }
  if (status === "queued") {
    return "bg-zinc-500/10 text-zinc-400 border border-zinc-700";
  }
  return "bg-zinc-500/10 text-zinc-400 border border-zinc-700";
}

function formatDuration(
  startedAt: string | null,
  completedAt: string | null
): string {
  if (!(startedAt && completedAt)) {
    return "—";
  }
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const s = ms / 1000;
  if (s < 60) {
    return `${s.toFixed(1)}s`;
  }
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

function shortTime(iso: string | null): string {
  if (!iso) {
    return "—";
  }
  return new Date(iso).toLocaleTimeString();
}

export function WorkerJobsTable({
  jobs,
  archivedAt = null,
}: {
  jobs: TarsJobRow[];
  archivedAt?: string | null;
}) {
  if (archivedAt) {
    return (
      <p className="py-8 text-center text-muted-foreground text-sm">
        Worker job rows archived with the run on{" "}
        {new Date(archivedAt).toLocaleDateString()}. Slim summary preserved on
        the run itself.
      </p>
    );
  }

  if (jobs.length === 0) {
    return (
      <p className="py-8 text-center text-muted-foreground text-sm">
        No worker jobs found for this run.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Kind</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Attempts</TableHead>
            <TableHead>Queued</TableHead>
            <TableHead>Started</TableHead>
            <TableHead>Completed</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Worker</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((job) => (
            <>
              <TableRow key={job.id}>
                <TableCell className="font-mono text-xs">{job.kind}</TableCell>
                <TableCell>
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 font-medium text-xs uppercase tracking-wide",
                      statusClass(job.status)
                    )}
                  >
                    {job.status}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {job.attempts}/{job.maxAttempts}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground text-xs">
                  {shortTime(job.createdAt)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground text-xs">
                  {shortTime(job.startedAt)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground text-xs">
                  {shortTime(job.completedAt)}
                </TableCell>
                <TableCell className="whitespace-nowrap font-mono text-xs">
                  {formatDuration(job.startedAt, job.completedAt)}
                </TableCell>
                <TableCell className="font-mono text-muted-foreground text-xs">
                  {job.workerId ?? "—"}
                </TableCell>
              </TableRow>
              {(job.status === "failed" || job.status === "error") &&
                job.errorText && (
                  <TableRow className="bg-red-950/10" key={`${job.id}-err`}>
                    <TableCell className="px-4 py-2" colSpan={8}>
                      <p className="break-all font-mono text-red-400 text-xs">
                        {job.errorText}
                      </p>
                    </TableCell>
                  </TableRow>
                )}
            </>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
