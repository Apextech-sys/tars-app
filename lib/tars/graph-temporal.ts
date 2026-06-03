/**
 * Server-side client for the tars-graph Temporal endpoints.
 *
 * Talks to tars-graph (Dokploy-internal) via TARS_GRAPH_URL — same pattern as
 * the knowledge/AWS clients. The graph service holds the Temporal Cloud SDK
 * connection (API-key auth); this is a thin read proxy. NO VM-102 dependency,
 * no iframe, no mTLS. Read-only.
 *
 *   GET /temporal/summary    -> { available, namespace, counts: {running,failed,...} }
 *   GET /temporal/workflows  -> { available, namespace, count, workflows: [...] }
 */

const TARS_GRAPH_URL = (process.env.TARS_GRAPH_URL ?? "").replace(/\/$/, "");
const TIMEOUT_MS = 22_000; // Temporal connect + list can take a few seconds

export interface TemporalWorkflow {
  id: string;
  runId: string;
  type: string;
  status: string;
  start: string;
  close: string;
}
export interface TemporalView {
  available: boolean;
  namespace: string;
  counts: Record<string, number>;
  workflows: TemporalWorkflow[];
  notes?: string;
}

async function graphFetch(path: string): Promise<unknown | null> {
  if (!TARS_GRAPH_URL) {
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${TARS_GRAPH_URL}${path}`, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Deep-link a workflow execution to its full event history in the Temporal Cloud console. */
export function cloudConsoleUrl(
  namespace: string,
  id: string,
  runId: string
): string {
  return `https://cloud.temporal.io/namespaces/${namespace}/workflows/${encodeURIComponent(
    id
  )}/${runId}/history`;
}

export function namespaceUrl(namespace: string): string {
  return `https://cloud.temporal.io/namespaces/${namespace}/workflows`;
}

export async function getTemporal(): Promise<TemporalView> {
  const [sumRaw, wfRaw] = await Promise.all([
    graphFetch("/temporal/summary"),
    graphFetch("/temporal/workflows"),
  ]);
  const sum = sumRaw as {
    available?: boolean;
    namespace?: string;
    counts?: Record<string, number>;
    notes?: string;
  } | null;
  const wf = wfRaw as {
    available?: boolean;
    namespace?: string;
    workflows?: TemporalWorkflow[];
    notes?: string;
  } | null;

  const workflows = Array.isArray(wf?.workflows) ? [...wf.workflows] : [];
  // newest first
  workflows.sort((a, b) => (b.start || "").localeCompare(a.start || ""));

  const available = Boolean(sum?.available || wf?.available);
  return {
    available,
    namespace: sum?.namespace || wf?.namespace || "",
    counts: sum?.counts ?? {},
    workflows,
    notes: available ? undefined : sum?.notes || wf?.notes || "tars-graph unreachable",
  };
}
