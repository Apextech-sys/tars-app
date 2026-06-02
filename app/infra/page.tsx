import { Cloud, DollarSign, GitFork, Layers, Server } from "lucide-react";
import { getInfra } from "@/lib/tars/graph-aws";

export const dynamic = "force-dynamic";

function money(n: number, ccy = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: ccy || "USD",
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

export default async function InfraPage() {
  const infra = await getInfra();

  if (!infra.available) {
    return (
      <div className="p-6 text-muted-foreground text-sm">
        Infrastructure graph unavailable (tars-graph unreachable).{" "}
        {infra.notes ?? ""}
      </div>
    );
  }

  const acct = infra.accounts[0];

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-semibold text-xl">
            <Cloud className="size-5 text-[#00d4a0]" /> Infrastructure
          </h1>
          <p className="text-muted-foreground text-sm">
            AWS read-only · account {acct?.accountId ?? "—"} (dev + staging).
            Prod is a separate account — not yet connected.
          </p>
        </div>
        <span className="rounded-full border border-[#00d4a0]/30 bg-[#00d4a0]/10 px-3 py-1 text-[#00d4a0] text-sm">
          {infra.totalResources} resources
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <DollarSign className="size-4" /> MONTH-TO-DATE COST
          </div>
          <div className="mt-1 font-semibold text-2xl">
            {money(infra.cost.total, infra.cost.currency)}
          </div>
          <div className="text-muted-foreground text-xs">
            {infra.cost.period.start || "—"} → {infra.cost.period.end || "—"}
          </div>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <Server className="size-4" /> RESOURCES
          </div>
          <div className="mt-1 font-semibold text-2xl">
            {infra.totalResources}
          </div>
          <div className="text-muted-foreground text-xs">
            {infra.byService.length} services · {infra.byRegion.length} regions
          </div>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <GitFork className="size-4" /> LINKED CODE
          </div>
          <div className="mt-1 font-semibold text-2xl">reflex-connect</div>
          <a
            className="text-[#00d4a0] text-xs hover:underline"
            href="https://github.com/Apextech-Dev/reflex-connect-v2"
            rel="noreferrer"
            target="_blank"
          >
            Apextech-Dev/reflex-connect-v2 ↗
          </a>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {infra.byStage.map((s) => (
          <span
            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm"
            key={s.key}
          >
            <Layers className="size-3.5 text-muted-foreground" />
            {s.key === "—" ? "untagged" : s.key}
            <span className="text-muted-foreground">{s.count}</span>
          </span>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 font-medium text-sm">Cost by service (MTD)</h2>
          <div className="rounded-xl border bg-card">
            {infra.cost.services.slice(0, 15).map((s) => (
              <div
                className="flex items-center justify-between border-b px-4 py-2 text-sm last:border-0"
                key={s.service}
              >
                <span className="truncate pr-3">{s.service}</span>
                <span className="font-medium tabular-nums">
                  {money(s.amount, s.currency)}
                </span>
              </div>
            ))}
            {infra.cost.services.length === 0 && (
              <div className="px-4 py-3 text-muted-foreground text-sm">
                No cost data yet.
              </div>
            )}
          </div>
        </section>
        <section>
          <h2 className="mb-2 font-medium text-sm">Resources by service</h2>
          <div className="rounded-xl border bg-card">
            {infra.byService.slice(0, 15).map((s) => (
              <div
                className="flex items-center justify-between border-b px-4 py-2 text-sm last:border-0"
                key={s.key}
              >
                <span className="truncate pr-3">{s.key}</span>
                <span className="font-medium text-muted-foreground tabular-nums">
                  {s.count}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
