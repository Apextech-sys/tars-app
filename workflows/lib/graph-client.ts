/**
 * Graph client for blast-radius queries.
 *
 * Marked `"use step"`; all Node imports are lazy.
 */

const BLAST_SCRIPT =
  process.env.TARS_BLAST_SCRIPT ?? "/home/shaun/.tars-state/tars_graph/blast.py";
const PYTHON_BIN = process.env.TARS_PYTHON_BIN ?? "/usr/bin/python3";
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
  const fs = await import("node:fs");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  if (!fs.existsSync(BLAST_SCRIPT)) {
    return {
      available: false,
      file: filePath,
      callers: [],
      openPrs: [],
      notes: `blast.py not found at ${BLAST_SCRIPT}`,
    };
  }

  try {
    const { stdout } = await execFileAsync(
      PYTHON_BIN,
      [BLAST_SCRIPT, "--repo", repo, "--file", filePath],
      { timeout: BLAST_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }
    );
    const parsed = JSON.parse(stdout.trim() || "{}") as Partial<BlastRadiusResult>;
    return {
      available: true,
      file: filePath,
      callers: Array.isArray(parsed.callers) ? parsed.callers : [],
      openPrs: Array.isArray(parsed.openPrs)
        ? parsed.openPrs.filter((n) => typeof n === "number")
        : [],
      notes: typeof parsed.notes === "string" ? parsed.notes : "",
    };
  } catch (err) {
    return {
      available: false,
      file: filePath,
      callers: [],
      openPrs: [],
      notes: `blast.py error: ${(err as Error).message}`,
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
