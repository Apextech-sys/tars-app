import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db/index";
import { tarsJobs } from "../db/worker-schema";

export interface DispatchOptions {
  idempotencyKey?: string;
  callbackUrl?: string;
  maxAttempts?: number;
  jobId?: string;
}

export async function dispatchJob(
  kind: string,
  payload: Record<string, unknown>,
  opts: DispatchOptions = {}
): Promise<string> {
  const id = opts.jobId ?? randomUUID();

  await db
    .insert(tarsJobs)
    .values({
      id,
      kind,
      payload,
      idempotencyKey: opts.idempotencyKey,
      callbackUrl: opts.callbackUrl,
      maxAttempts: opts.maxAttempts,
    })
    .onConflictDoNothing({ target: tarsJobs.idempotencyKey });

  if (opts.idempotencyKey) {
    const rows = await db
      .select({ id: tarsJobs.id })
      .from(tarsJobs)
      .where(sql`${tarsJobs.idempotencyKey} = ${opts.idempotencyKey}`)
      .limit(1);
    if (rows.length > 0) {
      return rows[0].id;
    }
  }
  return id;
}

export function verifyCallbackSignature(
  rawBody: string,
  signatureHex: string,
  secret: string
): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  if (expected.length !== signatureHex.length) {
    return false;
  }
  try {
    return timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(signatureHex, "hex")
    );
  } catch {
    return false;
  }
}

export async function waitForJob(
  jobId: string,
  opts: { timeoutMs?: number } = {}
): Promise<{
  status: "done" | "failed";
  result?: unknown;
  errorText?: string | null;
}> {
  const wf = await import("workflow");
  const waitForEvent = (
    wf as unknown as {
      waitForEvent: <T>(
        name: string,
        opts?: { timeoutMs?: number }
      ) => Promise<T>;
    }
  ).waitForEvent;
  if (typeof waitForEvent !== "function") {
    throw new Error(
      "workflow.waitForEvent unavailable — make sure this is called inside a WDK workflow"
    );
  }
  return waitForEvent<{
    status: "done" | "failed";
    result?: unknown;
    errorText?: string | null;
  }>(`job:${jobId}:done`, opts);
}
