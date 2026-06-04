/**
 * Server-side client for the tars-graph knowledge-graph endpoints.
 * Powers the in-TARS graph explorer (/knowledge). Degrades gracefully.
 */
const TARS_GRAPH_URL = (process.env.TARS_GRAPH_URL ?? "").replace(/\/$/, "");
const TIMEOUT_MS = 12_000;

export interface GraphStats {
  available: boolean;
  nodes: { type: string; count: number }[];
  edges: { type: string; count: number }[];
  totalNodes: number;
  totalEdges: number;
  notes?: string;
}
export interface SearchResult {
  id: string;
  type: string;
  label: string;
}
export interface Neighbor {
  id: string;
  type: string;
  label: string;
  rel: string;
  dir: "in" | "out";
}
export interface RelSummary {
  rel: string;
  dir: "in" | "out";
  type: string;
  count: number;
  shown: number;
}
export interface GraphNodeView {
  available: boolean;
  found: boolean;
  node?: {
    id: string;
    type: string;
    label: string;
    props: Record<string, unknown>;
  };
  neighbors: Neighbor[];
  relSummary: RelSummary[];
  notes?: string;
}

async function gfetch(path: string): Promise<unknown | null> {
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

export async function getGraphStats(): Promise<GraphStats> {
  const d = (await gfetch("/graph/stats")) as Partial<GraphStats> | null;
  if (!d) {
    return {
      available: false,
      nodes: [],
      edges: [],
      totalNodes: 0,
      totalEdges: 0,
      notes: "tars-graph unreachable",
    };
  }
  return {
    available: d.available !== false,
    nodes: Array.isArray(d.nodes) ? d.nodes : [],
    edges: Array.isArray(d.edges) ? d.edges : [],
    totalNodes: d.totalNodes ?? 0,
    totalEdges: d.totalEdges ?? 0,
  };
}

export async function searchGraph(q: string): Promise<SearchResult[]> {
  const d = (await gfetch(`/graph/search?q=${encodeURIComponent(q)}`)) as {
    results?: SearchResult[];
  } | null;
  return Array.isArray(d?.results) ? d.results : [];
}

export async function getGraphNode(id: string): Promise<GraphNodeView> {
  const d = (await gfetch(
    `/graph/node?id=${encodeURIComponent(id)}`,
  )) as Partial<GraphNodeView> | null;
  if (!d) {
    return {
      available: false,
      found: false,
      neighbors: [],
      relSummary: [],
      notes: "tars-graph unreachable",
    };
  }
  return {
    available: d.available !== false,
    found: Boolean(d.found),
    node: d.node,
    neighbors: Array.isArray(d.neighbors) ? d.neighbors : [],
    relSummary: Array.isArray(d.relSummary) ? d.relSummary : [],
  };
}
