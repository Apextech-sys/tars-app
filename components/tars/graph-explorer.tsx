"use client";

import {
  Background,
  Controls,
  type Edge,
  MiniMap,
  type Node,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, Loader2, Search, X } from "lucide-react";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Dir = "in" | "out";
interface Neighbor {
  id: string;
  type: string;
  label: string;
  rel: string;
  dir: Dir;
}
interface RelSummary {
  rel: string;
  dir: Dir;
  type: string;
  count: number;
  shown: number;
}
interface NodeData {
  found: boolean;
  node?: {
    id: string;
    type: string;
    label: string;
    props: Record<string, unknown>;
  };
  neighbors: Neighbor[];
  relSummary: RelSummary[];
}
interface SearchRes {
  id: string;
  type: string;
  label: string;
}

const TYPE_COLOR: Record<string, string> = {
  DocRepo: "#00d4a0",
  File: "#38bdf8",
  AwsResource: "#f59e0b",
  AwsAccount: "#a78bfa",
  Doc: "#34d399",
  Ticket: "#f472b6",
};
const TYPE_LABEL: Record<string, string> = {
  DocRepo: "Repo",
  File: "File",
  AwsResource: "AWS",
  AwsAccount: "Account",
  Doc: "Doc",
  Ticket: "Ticket",
};
const REL_LABEL: Record<string, string> = {
  IMPORTS: "imports",
  RESOURCE_FOR_REPO: "deploys",
  RESOURCE_IN_ACCOUNT: "in account",
  MENTIONS_FILE: "mentions",
  MENTIONS_REPO: "mentions",
  MENTIONS_TICKET: "mentions",
  IN_REPO: "in repo",
};

function pretty(type: string, label: string): string {
  if (type === "AwsResource" && label.startsWith("arn:")) {
    const parts = label.split(":");
    const svc = parts[2] || "aws";
    const tail = (parts[5] || "").split("/").pop() || parts[5] || label;
    return `${svc}:${tail}`.slice(0, 26);
  }
  if (type === "File") {
    return label.split("::").pop()?.split("/").slice(-2).join("/") ?? label;
  }
  return label.length > 30 ? `${label.slice(0, 28)}…` : label;
}

function nodeStyle(type: string, isCenter: boolean): CSSProperties {
  const c = TYPE_COLOR[type] ?? "#888888";
  return {
    background: isCenter ? c : `${c}22`,
    color: isCenter ? "#0b0b0c" : "#e4e4e7",
    border: `1px solid ${c}`,
    borderRadius: 8,
    fontSize: 11,
    padding: "6px 10px",
    width: 154,
    textAlign: "center",
    fontWeight: isCenter ? 700 : 500,
  };
}

function propRows(
  type: string,
  props: Record<string, unknown>,
): [string, string][] {
  const want: Record<string, string[]> = {
    AwsResource: ["service", "region", "stage", "restype"],
    File: ["repo", "language", "symbol_count"],
    DocRepo: [],
    Doc: ["last_edited"],
    Ticket: ["team"],
    AwsAccount: ["account_id"],
  };
  return (want[type] ?? [])
    .map((k) => [k, props[k]] as [string, unknown])
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => [k, String(v)] as [string, string]);
}

export function GraphExplorer({ initialId }: { initialId: string }) {
  const [centerId, setCenterId] = useState(initialId);
  const [data, setData] = useState<NodeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchRes[]>([]);
  const [searching, setSearching] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/tars/graph?op=node&id=${encodeURIComponent(centerId)}`)
      .then((r) => r.json())
      .then((d: NodeData) => {
        if (!cancelled) {
          setData(d);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setData(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [centerId]);

  const recenter = useCallback(
    (id: string) => {
      setHistory((h) => [...h, centerId]);
      setCenterId(id);
      setResults([]);
      setQ("");
    },
    [centerId],
  );

  const back = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) {
        return h;
      }
      setCenterId(h[h.length - 1]);
      return h.slice(0, -1);
    });
  }, []);

  const onSearch = useCallback((val: string) => {
    setQ(val);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    if (!val.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    timerRef.current = setTimeout(() => {
      fetch(`/api/tars/graph?op=search&q=${encodeURIComponent(val)}`)
        .then((r) => r.json())
        .then((d) => setResults(Array.isArray(d.results) ? d.results : []))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 250);
  }, []);

  const { nodes, edges } = useMemo(() => {
    const ns: Node[] = [];
    const es: Edge[] = [];
    const center = data?.node;
    if (!center) {
      return { nodes: ns, edges: es };
    }
    ns.push({
      id: center.id,
      position: { x: 0, y: 0 },
      data: { label: pretty(center.type, center.label) },
      style: nodeStyle(center.type, true),
    });
    const neigh = (data?.neighbors ?? []).slice(0, 40);
    const count = neigh.length || 1;
    const twoRings = count > 16;
    neigh.forEach((nb, i) => {
      const ring = twoRings && i % 2 === 1 ? 1 : 0;
      const radius = 290 + ring * 160;
      const angle = (i / count) * 2 * Math.PI;
      ns.push({
        id: nb.id,
        position: { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius },
        data: { label: pretty(nb.type, nb.label) },
        style: nodeStyle(nb.type, false),
      });
      const out = nb.dir === "out";
      es.push({
        id: `${center.id}__${nb.id}__${nb.rel}__${nb.dir}`,
        source: out ? center.id : nb.id,
        target: out ? nb.id : center.id,
        label: REL_LABEL[nb.rel] ?? nb.rel.toLowerCase(),
        style: { stroke: "#52525b" },
        labelStyle: { fill: "#a1a1aa", fontSize: 9 },
        labelBgStyle: { fill: "#18181b" },
      });
    });
    return { nodes: ns, edges: es };
  }, [data]);

  const onNodeClick = useCallback(
    (_evt: unknown, node: Node) => {
      if (node.id !== centerId) {
        recenter(node.id);
      }
    },
    [centerId, recenter],
  );

  const center = data?.node;
  const url =
    typeof center?.props?.url === "string" ? center.props.url : undefined;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="relative h-[600px] overflow-hidden rounded-xl border bg-card">
        <div className="absolute top-3 left-3 z-10 w-72">
          <div className="flex items-center gap-2 rounded-lg border bg-background/95 px-3 py-2 shadow-sm backdrop-blur">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              className="w-full bg-transparent text-sm outline-none"
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Search repos, files, AWS, docs…"
              value={q}
            />
            {searching ? (
              <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
            ) : null}
            {q ? (
              <button onClick={() => onSearch("")} type="button">
                <X className="size-4 shrink-0 text-muted-foreground" />
              </button>
            ) : null}
          </div>
          {results.length > 0 ? (
            <div className="mt-1 max-h-72 overflow-auto rounded-lg border bg-background shadow-lg">
              {results.map((r) => (
                <button
                  className="flex w-full items-center gap-2 border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-muted/60"
                  key={r.id}
                  onClick={() => recenter(r.id)}
                  type="button"
                >
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: TYPE_COLOR[r.type] ?? "#888888" }}
                  />
                  <span className="truncate">{pretty(r.type, r.label)}</span>
                  <span className="ml-auto shrink-0 text-muted-foreground text-xs">
                    {TYPE_LABEL[r.type] ?? r.type}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {history.length > 0 ? (
          <button
            className="absolute top-3 right-3 z-10 inline-flex items-center gap-1 rounded-lg border bg-background/95 px-2.5 py-1.5 text-sm shadow-sm backdrop-blur hover:bg-muted"
            onClick={back}
            type="button"
          >
            <ArrowLeft className="size-3.5" /> Back
          </button>
        ) : null}

        {loading ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/40">
            <Loader2 className="size-6 animate-spin text-[#00d4a0]" />
          </div>
        ) : null}

        <ReactFlow
          edges={edges}
          fitView
          key={centerId}
          maxZoom={1.5}
          minZoom={0.2}
          nodes={nodes}
          nodesConnectable={false}
          onNodeClick={onNodeClick}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#27272a" gap={20} />
          <Controls showInteractive={false} />
          <MiniMap
            nodeColor={(n) => (n.style?.background as string) ?? "#888888"}
            pannable
            zoomable
          />
        </ReactFlow>
      </div>

      <aside className="rounded-xl border bg-card p-4">
        {center ? (
          <div className="space-y-3">
            <div>
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs"
                style={{
                  background: `${TYPE_COLOR[center.type] ?? "#888888"}22`,
                  color: TYPE_COLOR[center.type] ?? "#a1a1aa",
                }}
              >
                <span
                  className="size-1.5 rounded-full"
                  style={{ background: TYPE_COLOR[center.type] ?? "#888888" }}
                />
                {TYPE_LABEL[center.type] ?? center.type}
              </span>
              <h3 className="mt-1 break-words font-semibold text-sm">
                {pretty(center.type, center.label)}
              </h3>
            </div>

            <dl className="space-y-1 text-xs">
              {propRows(center.type, center.props).map(([k, v]) => (
                <div className="flex gap-2" key={k}>
                  <dt className="w-20 shrink-0 text-muted-foreground">{k}</dt>
                  <dd className="break-words">{v}</dd>
                </div>
              ))}
            </dl>

            {url ? (
              <a
                className="inline-flex items-center gap-1 text-[#00d4a0] text-xs hover:underline"
                href={url}
                rel="noreferrer"
                target="_blank"
              >
                Open source ↗
              </a>
            ) : null}

            <div>
              <div className="mb-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                Connections
              </div>
              <div className="space-y-1">
                {data?.relSummary.map((rs) => (
                  <div
                    className="flex items-center justify-between rounded-md border px-2 py-1.5 text-xs"
                    key={`${rs.rel}-${rs.dir}-${rs.type}`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span
                        className="size-2 rounded-full"
                        style={{ background: TYPE_COLOR[rs.type] ?? "#888888" }}
                      />
                      {REL_LABEL[rs.rel] ?? rs.rel.toLowerCase()} ·{" "}
                      {TYPE_LABEL[rs.type] ?? rs.type}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {rs.shown < rs.count ? `${rs.shown} / ${rs.count}` : rs.count}
                    </span>
                  </div>
                ))}
                {data && data.relSummary.length === 0 ? (
                  <div className="text-muted-foreground text-xs">
                    No connections recorded for this node.
                  </div>
                ) : null}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Click any node in the graph to re-center and explore its
                connections.
              </p>
            </div>
          </div>
        ) : (
          <div className="text-muted-foreground text-sm">
            {loading ? "Loading…" : "Node not found."}
          </div>
        )}
      </aside>
    </div>
  );
}
