import { Network } from "lucide-react";
import { GraphExplorer } from "@/components/tars/graph-explorer";
import { getGraphStats } from "@/lib/tars/graph-explore";

export const dynamic = "force-dynamic";

const NODE_META: Record<string, { label: string; color: string }> = {
  DocRepo: { label: "Repos", color: "#00d4a0" },
  File: { label: "Files", color: "#38bdf8" },
  AwsResource: { label: "AWS resources", color: "#f59e0b" },
  AwsAccount: { label: "Accounts", color: "#a78bfa" },
  Doc: { label: "Docs", color: "#34d399" },
  Ticket: { label: "Tickets", color: "#f472b6" },
};

export default async function KnowledgePage() {
  const stats = await getGraphStats();

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      <header>
        <h1 className="flex items-center gap-2 font-semibold text-xl">
          <Network className="size-5 text-[#00d4a0]" /> Knowledge Graph
        </h1>
        <p className="max-w-3xl text-muted-foreground text-sm">
          The connected map of Reflex Connect — every repo, source file, AWS
          resource, doc and ticket TARS has discovered, and how they link to
          each other. Search for anything or click a node to explore its
          relationships; it all stays in here.
        </p>
      </header>

      {stats.available ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {stats.nodes.map((n) => {
              const meta = NODE_META[n.type] ?? {
                label: n.type,
                color: "#888888",
              };
              return (
                <div className="rounded-xl border bg-card p-3" key={n.type}>
                  <div className="flex items-center gap-2 text-muted-foreground text-xs">
                    <span
                      className="size-2.5 rounded-full"
                      style={{ background: meta.color }}
                    />
                    {meta.label}
                  </div>
                  <div className="mt-1 font-semibold text-2xl tabular-nums">
                    {n.count.toLocaleString()}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="text-muted-foreground text-xs">
            {stats.totalNodes.toLocaleString()} entities ·{" "}
            {stats.totalEdges.toLocaleString()} relationships in the graph
          </div>

          <GraphExplorer initialId="Apextech-Dev/reflex-connect-v2" />
        </>
      ) : (
        <div className="rounded-xl border bg-card p-6 text-muted-foreground text-sm">
          Knowledge graph unavailable ({stats.notes ?? "tars-graph unreachable"}
          ).
        </div>
      )}
    </div>
  );
}
