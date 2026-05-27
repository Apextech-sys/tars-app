import { createHmac } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { fetch } from "undici";
import type { Config } from "./config.js";
import { callbackUrl } from "./config.js";
import { logger } from "./logger.js";
import type { JobRow } from "./types.js";

export interface CallbackBody {
  jobId: string;
  kind: string;
  status: "done" | "failed";
  result?: unknown;
  errorText?: string | null;
  sessionId?: string | null;
  attempts: number;
  workerId: string;
  completedAt: string;
}

export function signCallback(
  body: CallbackBody,
  secret: string
): { payload: string; signature: string } {
  const payload = JSON.stringify(body);
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  return { payload, signature };
}

export async function postCallback(
  cfg: Config,
  job: JobRow,
  body: CallbackBody
): Promise<boolean> {
  const url = job.callbackUrl ?? callbackUrl(cfg);
  const { payload, signature } = signCallback(
    body,
    cfg.TARS_WORKER_CALLBACK_SECRET
  );
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-tars-worker-id": cfg.TARS_WORKER_ID,
    "x-tars-signature": signature,
    "x-tars-job-id": job.id,
  };
  if (job.callbackSignedToken) {
    headers["x-tars-job-token"] = job.callbackSignedToken;
  }

  const maxAttempts = 5;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        body: payload,
        headers,
      });
      if (res.status >= 200 && res.status < 300) {
        logger().info(
          { jobId: job.id, attempt, status: res.status },
          "callback delivered"
        );
        return true;
      }
      lastErr = new Error(`callback ${res.status}: ${await res.text()}`);
      logger().warn(
        { jobId: job.id, attempt, status: res.status },
        "callback non-2xx"
      );
    } catch (err) {
      lastErr = err;
      logger().warn({ jobId: job.id, attempt, err }, "callback fetch error");
    }
    if (attempt < maxAttempts) {
      const backoff = Math.min(2 ** attempt * 250, 10_000);
      await sleep(backoff);
    }
  }
  logger().error({ jobId: job.id, lastErr }, "callback failed after retries");
  return false;
}
