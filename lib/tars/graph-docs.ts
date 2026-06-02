/**
 * Server-side client for the tars-graph knowledge/doc endpoints.
 *
 * Talks to the tars-graph HTTP service (Dokploy-internal network) via
 * TARS_GRAPH_URL — the same env the blast-radius client uses. NO VM-102
 * dependency: this is the Dokploy-native graph service.
 *
 * Endpoints consumed:
 *   GET  /docs            -> { available, docs: [...] }
 *   GET  /doc?id=<nid>    -> { available, found, doc, files, tickets, repos }
 *   POST /file-docs       -> { available, docs: [...] }  (docs mentioning a file)
 *
 * All calls degrade gracefully: on any failure they return an "unavailable"
 * shape so the UI can show an empty/soft state instead of throwing.
 */

const TARS_GRAPH_URL = (process.env.TARS_GRAPH_URL ?? "").replace(/\/$/, "");
const TIMEOUT_MS = 12_000;

export interface KnowledgeDocSummary {
  notionId: string;
  title: string;
  url: string;
  lastEdited: string;
  ingestedAt: string;
  fileCount: number;
  ticketCount: number;
  repoCount: number;
}

export interface LinkedFile {
  repo: string;
  path: string;
}
export interface LinkedTicket {
  identifier: string;
  team: string;
  title: string;
  url: string;
}
export interface LinkedRepo {
  fullName: string;
  url: string;
}

export interface KnowledgeDocDetail {
  available: boolean;
  found: boolean;
  doc: {
    notionId: string;
    title: string;
    url: string;
    lastEdited: string;
    ingestedAt: string;
  } | null;
  files: LinkedFile[];
  tickets: LinkedTicket[];
  repos: LinkedRepo[];
  notes?: string;
}

async function graphFetch(
  path: string,
  init?: RequestInit
): Promise<unknown | null> {
  if (!TARS_GRAPH_URL) {
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${TARS_GRAPH_URL}${path}`, {
      ...init,
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

export async function listKnowledgeDocs(): Promise<{
  available: boolean;
  docs: KnowledgeDocSummary[];
}> {
  const data = (await graphFetch("/docs")) as {
    available?: boolean;
    docs?: KnowledgeDocSummary[];
  } | null;
  if (!data) {
    return { available: false, docs: [] };
  }
  return {
    available: data.available !== false,
    docs: Array.isArray(data.docs) ? data.docs : [],
  };
}

export async function getKnowledgeDoc(
  notionId: string
): Promise<KnowledgeDocDetail> {
  const data = (await graphFetch(
    `/doc?id=${encodeURIComponent(notionId)}`
  )) as Partial<KnowledgeDocDetail> | null;
  if (!data) {
    return {
      available: false,
      found: false,
      doc: null,
      files: [],
      tickets: [],
      repos: [],
      notes: "tars-graph unreachable",
    };
  }
  return {
    available: data.available !== false,
    found: data.found === true,
    doc: data.doc ?? null,
    files: Array.isArray(data.files) ? data.files : [],
    tickets: Array.isArray(data.tickets) ? data.tickets : [],
    repos: Array.isArray(data.repos) ? data.repos : [],
    notes: typeof data.notes === "string" ? data.notes : undefined,
  };
}

export async function docsForFile(
  repo: string,
  file: string
): Promise<{
  available: boolean;
  docs: { notionId: string; title: string; url: string }[];
}> {
  const data = (await graphFetch("/file-docs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo, file }),
  })) as {
    available?: boolean;
    docs?: { notionId: string; title: string; url: string }[];
  } | null;
  if (!data) {
    return { available: false, docs: [] };
  }
  return {
    available: data.available !== false,
    docs: Array.isArray(data.docs) ? data.docs : [],
  };
}

/** Build a GitHub blob URL for a repo-relative path on the main branch. */
export function githubFileUrl(repo: string, path: string): string {
  return `https://github.com/${repo}/blob/main/${path}`;
}
