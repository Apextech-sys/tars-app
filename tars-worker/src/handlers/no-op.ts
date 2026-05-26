import { setTimeout as sleep } from "node:timers/promises";
import type { JobHandler } from "../types.js";

export const noOpHandler: JobHandler = async (ctx) => {
  const sleepMs =
    typeof (ctx.job.payload as { sleepMs?: unknown })?.sleepMs === "number"
      ? ((ctx.job.payload as { sleepMs: number }).sleepMs as number)
      : 5_000;

  ctx.log("no-op sleeping", { sleepMs });
  await sleep(sleepMs, undefined, { signal: ctx.signal });

  return {
    echo: ctx.job.payload,
    ts: new Date().toISOString(),
    jobId: ctx.job.id,
  };
};
