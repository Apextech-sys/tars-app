/**
 * Graph client for blast-radius queries.
 *
 * Calls the tars-graph HTTP service (Dokploy-internal network).
 * Falls back gracefully when the service is unreachable — the worker
 * continues, blast-radius is marked unavailable.
 *
 * Env:
 *   TARS_GRAPH_URL  — base URL of the tars-graph service (no trailing slash)
 *                     e.g. http://tars-graph:8765
 *                     Defaults to empty string → graceful-degrade immediately.
 */

const TARS_GRAPH_URL = (process.env.TARS_GRAPH_URL ?? "").replace(/\/$/, "");
const BLAST_TIMEOUT_MS = 15_000;

export interface BlastRadiusResult {
  available: boolean;
  file: string;
  callers: string[];
  openPrs: number[];
  notes: string;
}

export async function getBlastRadius(
  repo: string,
  filePath: string
): Promise<BlastRadiusResult> {
  "use step";

  if (!TARS_GRAPH_URL) {
    return {
      available: false,
      file: filePath,
      callers: [],
      openPrs: [],
      notes: "TARS_GRAPH_URL not configured",
    };
  }

  const url = `${TARS_GRAPH_URL}/blast-radius`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BLAST_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo, file: filePath }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      return {
        available: false,
        file: filePath,
        callers: [],
        openPrs: [],
        notes: `tars-graph HTTP ${res.status}`,
      };
    }

    const parsed = (await res.json()) as Partial<BlastRadiusResult>;
    return {
      available: parsed.available !== false,
      file: filePath,
      callers: Array.isArray(parsed.callers) ? parsed.callers : [],
      openPrs: Array.isArray(parsed.openPrs)
        ? parsed.openPrs.filter((n) => typeof n === "number")
        : [],
      notes: typeof parsed.notes === "string" ? parsed.notes : "",
    };
  } catch (err) {
    // Network error or timeout — degrade gracefully
    const msg = err instanceof Error ? err.message : String(err);
    return {
      available: false,
      file: filePath,
      callers: [],
      openPrs: [],
      notes: `tars-graph unreachable: ${msg}`,
    };
  }
}

export async function getBlastRadiusForFiles(
  repo: string,
  files: string[]
): Promise<BlastRadiusResult[]> {
  "use step";
  const limited = files.slice(0, 25);
  const results: BlastRadiusResult[] = [];
  for (const f of limited) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await getBlastRadius(repo, f));
  }
  return results;
}
// gate-test: graph migration verification marker (safe to delete)
