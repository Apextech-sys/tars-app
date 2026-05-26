import type { TarsJob } from "../../lib/db/worker-schema.js";

export type JobRow = TarsJob;

export type JobStatus =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "cancelled";

export interface HandlerContext {
  job: JobRow;
  signal: AbortSignal;
  updateSessionId: (sessionId: string) => Promise<void>;
  log: (msg: string, fields?: Record<string, unknown>) => void;
}

// biome-ignore lint/suspicious/noExplicitAny: handler result is opaque
export type JobResult = any;

export type JobHandler = (ctx: HandlerContext) => Promise<JobResult>;
