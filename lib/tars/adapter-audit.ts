/**
 * Adapter audit helper — plain async function (no "use step") so it can be
 * called directly from Next.js route handlers.
 *
 * Writes both to /home/shaun/.tars-state/audit.jsonl (file tail) AND to the
 * audit_log Postgres table. Failures are logged but never bubble up — audit
 * is best-effort.
 */
import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/tars-schema";

const AUDIT_LOG_PATH =
  process.env.TARS_AUDIT_LOG_PATH ?? "/home/shaun/.tars-state/audit.jsonl";

export interface AdapterAuditEntry {
  runId: string;
  workflow: "slack-adapter" | "linear-adapter";
  step: string;
  status: "start" | "ok" | "skip" | "error" | "info";
  message?: string;
  data?: Record<string, unknown>;
}

export async function writeAdapterAudit(
  entry: AdapterAuditEntry
): Promise<void> {
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const row = { ts: new Date().toISOString(), ...entry };
    await fs.mkdir(path.dirname(AUDIT_LOG_PATH), { recursive: true });
    await fs.appendFile(AUDIT_LOG_PATH, `${JSON.stringify(row)}\n`, "utf8");
  } catch (err) {
    if (process.env.TARS_DEBUG_AUDIT) {
      console.warn(
        "[adapter-audit] file write failed:",
        (err as Error).message
      );
    }
  }

  try {
    await db.insert(auditLog).values({
      runId: entry.runId,
      workflow: entry.workflow,
      step: entry.step,
      status: entry.status,
      message: entry.message ?? null,
      // biome-ignore lint/suspicious/noExplicitAny: jsonb passthrough
      data: (entry.data ?? null) as any,
    });
  } catch (err) {
    if (process.env.TARS_DEBUG_AUDIT) {
      console.warn("[adapter-audit] db write failed:", (err as Error).message);
    }
  }
}
