import {
  Activity,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Cloud,
  Database,
  DollarSign,
  GitFork,
  Layers,
  type Server,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  ENV_NONPROD,
  ENV_PROD,
  type EnvBreakdown,
  envForAccount,
  getInfra,
  getOps,
  type OpsAccount,
} from "@/lib/tars/graph-aws";

export const dynamic = "force-dynamic";

function money(n: number, ccy = "USD", compact = false): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: ccy || "USD",
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: compact ? 1 : 2,
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

const RE_TARGET_TRACKING = /^TargetTracking-/i;
const RE_ALARM_LOW = /AlarmLow/i;
const RE_ALARM_HIGH = /AlarmHigh/i;
const RE_UUID_SUFFIX = /-[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const RE_HEX_SUFFIX = /-[0-9a-f]{6,}$/i;
const RE_NUM_SUFFIX = /[-_]\d{6,}$/i;
const RE_SECURITY =
  /anomal|secret|root|unauthor|\biam\b|guardduty|threat|console|signin|login|access|breach/;
const RE_AUTOSCALE = /autoscal|scale-in|scale-out|targettracking/;

/** Collapse noisy alarm names into a human "kind" so 66 firing alarms read as a handful of issues. */
function alarmKind(name: string): string {
  if (RE_TARGET_TRACKING.test(name)) {
    if (RE_ALARM_LOW.test(name)) {
      return "ECS autoscaling · scale-in";
    }
    if (RE_ALARM_HIGH.test(name)) {
      return "ECS autoscaling · scale-out";
    }
    return "ECS autoscaling";
  }
  return name
    .replace(RE_UUID_SUFFIX, "")
    .replace(RE_HEX_SUFFIX, "")
    .replace(RE_NUM_SUFFIX, "");
}

type Severity = "security" | "ops" | "info";
function alarmSeverity(kind: string): Severity {
  const k = kind.toLowerCase();
  if (RE_SECURITY.test(k)) {
    return "security";
  }
  if (RE_AUTOSCALE.test(k)) {
    return "info";
  }
  return "ops";
}

interface AlarmGroup {
  kind: string;
  severity: Severity;
  count: number;
  samples: { name: string; reason: string }[];
}
function groupAlarms(firing: { name: string; reason: string }[]): AlarmGroup[] {
  const m = new Map<string, AlarmGroup>();
  for (const a of firing) {
    const kind = alarmKind(a.name);
    const g = m.get(kind) ?? {
      kind,
      severity: alarmSeverity(kind),
      count: 0,
      samples: [],
    };
    g.count += 1;
    if (g.samples.length < 6) {
      g.samples.push(a);
    }
    m.set(kind, g);
  }
  const rank: Record<Severity, number> = { security: 0, ops: 1, info: 2 };
  return [...m.values()].sort(
    (a, b) => rank[a.severity] - rank[b.severity] || b.count - a.count
  );
}

const SEV_STYLE: Record<
  Severity,
  { dot: string; chip: string; label: string }
> = {
  security: {
    dot: "bg-red-500",
    chip: "border-red-500/30 bg-red-500/10 text-red-400",
    label: "Security",
  },
  ops: {
    dot: "bg-amber-500",
    chip: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    label: "Operational",
  },
  info: {
    dot: "bg-muted-foreground/50",
    chip: "border-border bg-muted/40 text-muted-foreground",
    label: "Autoscaling",
  },
};

type Tone = "neutral" | "good" | "warn" | "bad";
const TONE_ACCENT: Record<Tone, string> = {
  bad: "text-red-400",
  warn: "text-amber-400",
  good: "text-[#00d4a0]",
  neutral: "text-foreground",
};

function serviceHealthy(s: {
  running: number;
  desired: number;
  status: string;
}) {
  return s.status === "ACTIVE" && s.running >= s.desired && s.desired > 0;
}

/** Sum each account's daily cost trend into one combined series. */
function combinedTrend(
  accounts: OpsAccount[]
): { date: string; amount: number }[] {
  const m = new Map<string, number>();
  for (const acc of accounts) {
    for (const p of acc.costTrend ?? []) {
      m.set(p.date, (m.get(p.date) ?? 0) + p.amount);
    }
  }
  return [...m.entries()]
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function StatTile({
  icon: Icon,
  label,
  value,
  sub,
  tone = "neutral",
}: {
  icon: typeof Server;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
        <Icon className="size-4" /> {label}
      </div>
      <div className={`mt-1 font-semibold text-2xl ${TONE_ACCENT[tone]}`}>
        {value}
      </div>
      {sub ? <div className="text-muted-foreground text-xs">{sub}</div> : null}
    </div>
  );
}

interface EnvSummary {
  env: string;
  accountId: string;
  cost: number;
  trend: { date: string; amount: number }[];
  healthy: number;
  totalSvc: number;
  firing: number;
  secFiring: number;
  rdsCount: number;
  rdsUnhealthy: number;
  resourceCount: number;
  inf?: EnvBreakdown;
}

function EnvCard({ data, currency }: { data: EnvSummary; currency: string }) {
  const isProd = data.env === ENV_PROD;
  const max = Math.max(1, ...data.trend.map((p) => p.amount));
  const degraded = data.totalSvc - data.healthy;
  let alarmColor = "";
  if (data.secFiring > 0) {
    alarmColor = "text-red-400";
  } else if (data.firing > 0) {
    alarmColor = "text-amber-400";
  }
  return (
    <div
      className={`rounded-xl border bg-card p-4 ${
        isProd ? "border-[#00d4a0]/40" : ""
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`size-2.5 rounded-full ${
              isProd ? "bg-[#00d4a0]" : "bg-sky-400"
            }`}
          />
          <span className="font-semibold text-sm">{data.env}</span>
        </div>
        <span className="font-mono text-muted-foreground text-xs">
          {data.accountId}
        </span>
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <div className="text-muted-foreground text-xs uppercase tracking-wide">
            Spend (last {data.trend.length}d)
          </div>
          <div className="font-semibold text-2xl">
            {money(data.cost, currency)}
          </div>
        </div>
        {data.trend.length > 0 ? (
          <div className="flex h-12 flex-1 items-end justify-end gap-px">
            {data.trend.map((p) => (
              <div
                className="w-1.5 rounded-t bg-[#00d4a0]/70"
                key={p.date}
                style={{ height: `${Math.max(4, (p.amount / max) * 100)}%` }}
                title={`${p.date}: ${money(p.amount, currency)}`}
              />
            ))}
          </div>
        ) : null}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div>
          <div className="text-muted-foreground text-xs">Services</div>
          <div className={`font-medium ${degraded > 0 ? "text-red-400" : ""}`}>
            {data.healthy}/{data.totalSvc}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs">Alarms</div>
          <div className={`font-medium ${alarmColor}`}>
            {data.firing}
            {data.secFiring > 0 ? ` (${data.secFiring} sec)` : ""}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs">Databases</div>
          <div
            className={`font-medium ${
              data.rdsUnhealthy > 0 ? "text-red-400" : ""
            }`}
          >
            {data.rdsCount}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs">Resources</div>
          <div className="font-medium">{data.resourceCount}</div>
        </div>
      </div>
    </div>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: presentational operator dashboard composing many independent read-only panels (status banner, hero stats, alerts, ECS service health, cost trend, RDS, inventory) — complexity is breadth of sections, not tangled control flow
export default async function InfraPage() {
  const [infra, ops] = await Promise.all([getInfra(), getOps()]);

  if (!(infra.available || ops.available)) {
    return (
      <div className="p-6 text-muted-foreground text-sm">
        Infrastructure graph unavailable (tars-graph unreachable).{" "}
        {infra.notes ?? ops.notes ?? ""}
      </div>
    );
  }

  const opsAccounts = ops.accounts ?? [];
  const allServices = opsAccounts.flatMap((a) =>
    (a.services ?? []).map((s) => ({ ...s, account: a.label }))
  );
  const healthyCount = allServices.filter(serviceHealthy).length;
  const degraded = allServices.filter((s) => !serviceHealthy(s));
  const allRds = opsAccounts.flatMap((a) =>
    (a.rds ?? []).map((r) => ({ ...r, account: a.label }))
  );
  const rdsUnhealthy = allRds.filter(
    (r) => r.status.toLowerCase() !== "available"
  );
  const totalFiring = opsAccounts.reduce(
    (n, a) => n + (a.alarms?.ALARM ?? 0),
    0
  );
  const securityFiring = opsAccounts.reduce(
    (n, a) =>
      n +
      groupAlarms(a.alarms?.firing ?? [])
        .filter((g) => g.severity === "security")
        .reduce((m, g) => m + g.count, 0),
    0
  );

  const trend = combinedTrend(opsAccounts);
  const maxTrend = Math.max(1, ...trend.map((p) => p.amount));
  const latest = trend.at(-1);
  const prev = trend.at(-2);
  const delta = latest && prev ? latest.amount - prev.amount : 0;

  const nominal =
    degraded.length === 0 && totalFiring === 0 && rdsUnhealthy.length === 0;

  // Precomputed presentation values (kept out of JSX to avoid nested ternaries).
  let bannerClass = "border-[#00d4a0]/30 bg-[#00d4a0]/10 text-[#00d4a0]";
  if (!nominal) {
    bannerClass =
      securityFiring > 0 || degraded.length > 0
        ? "border-red-500/30 bg-red-500/10 text-red-400"
        : "border-amber-500/30 bg-amber-500/10 text-amber-400";
  }

  let costSub: ReactNode = `${infra.cost.period.start || "—"} → ${
    infra.cost.period.end || "—"
  }`;
  if (latest) {
    const TrendIcon = delta >= 0 ? TrendingUp : TrendingDown;
    const trendColor = delta >= 0 ? "text-amber-400" : "text-[#00d4a0]";
    costSub = (
      <span className="inline-flex items-center gap-1">
        <TrendIcon className={`size-3 ${trendColor}`} />
        {money(latest.amount, infra.cost.currency, true)}/day latest
      </span>
    );
  }

  let svcTone: Tone = "neutral";
  if (degraded.length > 0) {
    svcTone = "bad";
  } else if (allServices.length > 0) {
    svcTone = "good";
  }
  let svcSub = "ops unavailable";
  if (degraded.length > 0) {
    svcSub = `${degraded.length} degraded`;
  } else if (allServices.length > 0) {
    svcSub = "all healthy";
  } else if (ops.available) {
    svcSub = "none";
  }

  let alarmTone: Tone = "good";
  if (securityFiring > 0) {
    alarmTone = "bad";
  } else if (totalFiring > 0) {
    alarmTone = "warn";
  }
  let alarmSub = "none firing";
  if (securityFiring > 0) {
    alarmSub = `${securityFiring} security · rest mostly autoscaling`;
  } else if (totalFiring > 0) {
    alarmSub = "mostly autoscaling noise";
  }

  let dbTone: Tone = "neutral";
  if (rdsUnhealthy.length > 0) {
    dbTone = "bad";
  } else if (allRds.length > 0) {
    dbTone = "good";
  }
  let dbSub = "no RDS instances";
  if (allRds.length > 0) {
    dbSub =
      rdsUnhealthy.length > 0
        ? `${rdsUnhealthy.length} not available`
        : "all available";
  }

  // Per-environment rollup: Dev+Staging (Apextech account) vs Production (Konverge account).
  const envData: EnvSummary[] = [ENV_NONPROD, ENV_PROD]
    .map((env) => {
      const opsAcc = opsAccounts.find(
        (a) => envForAccount(a.accountId, a.label) === env
      );
      const inf = infra.environments.find((e) => e.env === env);
      const trend = opsAcc?.costTrend ?? [];
      const services = opsAcc?.services ?? [];
      const rds = opsAcc?.rds ?? [];
      const secFiring = groupAlarms(opsAcc?.alarms?.firing ?? [])
        .filter((g) => g.severity === "security")
        .reduce((m, g) => m + g.count, 0);
      return {
        env,
        accountId: opsAcc?.accountId ?? "",
        cost: trend.reduce((n, p) => n + p.amount, 0),
        trend,
        healthy: services.filter(serviceHealthy).length,
        totalSvc: services.length,
        firing: opsAcc?.alarms?.ALARM ?? 0,
        secFiring,
        rdsCount: rds.length,
        rdsUnhealthy: rds.filter((r) => r.status.toLowerCase() !== "available")
          .length,
        resourceCount: inf?.resourceCount ?? 0,
        inf,
      };
    })
    .filter((e) => e.accountId !== "" || e.resourceCount > 0);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-semibold text-xl">
            <Cloud className="size-5 text-[#00d4a0]" /> Infrastructure
          </h1>
          <p className="text-muted-foreground text-sm">
            AWS read-only · {infra.accounts.length || opsAccounts.length}{" "}
            account
            {(infra.accounts.length || opsAccounts.length) === 1 ? "" : "s"} ·
            dev, staging &amp; production · eu-west-1
          </p>
        </div>
        <span className="rounded-full border border-[#00d4a0]/30 bg-[#00d4a0]/10 px-3 py-1 text-[#00d4a0] text-sm">
          {infra.totalResources} resources
        </span>
      </div>

      {/* System status banner */}
      <div
        className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border px-4 py-3 text-sm ${bannerClass}`}
      >
        {nominal ? (
          <span className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="size-4" /> All systems nominal
          </span>
        ) : (
          <span className="flex items-center gap-2 font-medium">
            <AlertTriangle className="size-4" /> Attention required
          </span>
        )}
        {securityFiring > 0 && (
          <span>
            · {securityFiring} security alarm{securityFiring === 1 ? "" : "s"}{" "}
            firing
          </span>
        )}
        {degraded.length > 0 && (
          <span>
            · {degraded.length} service{degraded.length === 1 ? "" : "s"}{" "}
            degraded
          </span>
        )}
        {rdsUnhealthy.length > 0 && (
          <span>
            · {rdsUnhealthy.length} database
            {rdsUnhealthy.length === 1 ? "" : "s"} not available
          </span>
        )}
        {totalFiring > 0 && (
          <span className="text-muted-foreground">
            · {totalFiring} alarms in ALARM state total
          </span>
        )}
      </div>

      {/* Hero stat row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={DollarSign}
          label="Month-to-date cost"
          sub={costSub}
          value={money(infra.cost.total, infra.cost.currency)}
        />
        <StatTile
          icon={Activity}
          label="ECS services"
          sub={svcSub}
          tone={svcTone}
          value={
            allServices.length > 0 ? (
              <>
                {healthyCount}
                <span className="text-base text-muted-foreground">
                  /{allServices.length}
                </span>
              </>
            ) : (
              "—"
            )
          }
        />
        <StatTile
          icon={ShieldAlert}
          label="Alarms firing"
          sub={alarmSub}
          tone={alarmTone}
          value={totalFiring}
        />
        <StatTile
          icon={Database}
          label="Databases"
          sub={dbSub}
          tone={dbTone}
          value={allRds.length || "—"}
        />
      </div>

      {/* Environments: Dev+Staging vs Production */}
      {envData.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-2 font-medium text-sm">
            <Layers className="size-4 text-[#00d4a0]" /> Environments
            <span className="font-normal text-muted-foreground">
              · spend, health, databases &amp; resources side by side
            </span>
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {envData.map((d) => (
              <EnvCard currency={infra.cost.currency} data={d} key={d.env} />
            ))}
          </div>
        </section>
      )}

      {/* Alerts panel */}
      {totalFiring > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-2 font-medium text-sm">
            <AlertTriangle className="size-4 text-amber-400" /> Active alarms
            <span className="text-muted-foreground">({totalFiring})</span>
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {opsAccounts
              .filter((a) => (a.alarms?.firing ?? []).length > 0)
              .map((a) => {
                const groups = groupAlarms(a.alarms.firing);
                return (
                  <div
                    className="rounded-xl border bg-card p-4"
                    key={a.accountId}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="font-medium text-sm">{a.label}</span>
                      <span className="text-muted-foreground text-xs">
                        {a.alarms.ALARM} firing · {a.alarms.OK} ok
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {groups.map((g) => {
                        const st = SEV_STYLE[g.severity];
                        return (
                          <details className="group" key={g.kind}>
                            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/50">
                              <span
                                className={`size-2 rounded-full ${st.dot}`}
                              />
                              <span className="truncate">{g.kind}</span>
                              <span
                                className={`ml-auto rounded-full border px-2 text-xs ${st.chip}`}
                              >
                                {g.count}
                              </span>
                            </summary>
                            <ul className="mt-1 ml-4 space-y-1 border-l pl-3">
                              {g.samples.map((s) => (
                                <li
                                  className="text-muted-foreground text-xs"
                                  key={s.name}
                                >
                                  <span className="font-mono">{s.name}</span>
                                  {s.reason ? (
                                    <span className="block truncate opacity-70">
                                      {s.reason}
                                    </span>
                                  ) : null}
                                </li>
                              ))}
                              {g.count > g.samples.length && (
                                <li className="text-muted-foreground text-xs opacity-70">
                                  +{g.count - g.samples.length} more
                                </li>
                              )}
                            </ul>
                          </details>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
          </div>
        </section>
      )}

      {/* ECS service health */}
      {allServices.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-2 font-medium text-sm">
            <Activity className="size-4 text-[#00d4a0]" /> Service health
            <span className="text-muted-foreground">
              ({healthyCount}/{allServices.length} healthy)
            </span>
          </h2>
          <div className="space-y-4">
            {opsAccounts
              .filter((a) => (a.services ?? []).length > 0)
              .map((a) => {
                const byCluster = new Map<string, OpsAccount["services"]>();
                for (const s of a.services) {
                  const arr = byCluster.get(s.cluster) ?? [];
                  arr.push(s);
                  byCluster.set(s.cluster, arr);
                }
                return (
                  <div key={a.accountId}>
                    <div className="mb-1.5 flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
                      {envForAccount(a.accountId, a.label)}
                      <span className="font-mono lowercase opacity-70">
                        {a.accountId}
                      </span>
                    </div>
                    {[...byCluster.entries()].map(([cluster, svcs]) => (
                      <div className="mb-3" key={cluster}>
                        <div className="mb-1 font-mono text-muted-foreground text-xs">
                          {cluster}
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {svcs
                            .slice()
                            .sort(
                              (x, y) =>
                                Number(serviceHealthy(x)) -
                                Number(serviceHealthy(y))
                            )
                            .map((s) => {
                              const ok = serviceHealthy(s);
                              return (
                                <div
                                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                                    ok
                                      ? "bg-card"
                                      : "border-red-500/40 bg-red-500/5"
                                  }`}
                                  key={s.name}
                                >
                                  <span className="flex min-w-0 items-center gap-2">
                                    <span
                                      className={`size-2 shrink-0 rounded-full ${
                                        ok ? "bg-[#00d4a0]" : "bg-red-500"
                                      }`}
                                    />
                                    <span className="truncate">{s.name}</span>
                                  </span>
                                  <span
                                    className={`shrink-0 font-medium tabular-nums ${
                                      ok
                                        ? "text-muted-foreground"
                                        : "text-red-400"
                                    }`}
                                  >
                                    {s.running}/{s.desired}
                                  </span>
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
          </div>
        </section>
      )}

      {/* Cost: trend chart + by-service */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 flex items-center gap-2 font-medium text-sm">
            <TrendingUp className="size-4 text-[#00d4a0]" /> Daily cost (last{" "}
            {trend.length} days)
          </h2>
          <div className="rounded-xl border bg-card p-4">
            {trend.length > 0 ? (
              <>
                <div className="flex h-32 items-end gap-1">
                  {trend.map((p) => (
                    <div
                      className="group relative flex-1"
                      key={p.date}
                      title={`${p.date}: ${money(p.amount, infra.cost.currency)}`}
                    >
                      <div
                        className="w-full rounded-t bg-[#00d4a0]/70 transition-colors group-hover:bg-[#00d4a0]"
                        style={{
                          height: `${Math.max(2, (p.amount / maxTrend) * 100)}%`,
                        }}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex justify-between text-muted-foreground text-xs">
                  <span>{trend[0]?.date}</span>
                  <span className="tabular-nums">
                    peak {money(maxTrend, infra.cost.currency, true)}/day
                  </span>
                  <span>{latest?.date}</span>
                </div>
              </>
            ) : (
              <div className="text-muted-foreground text-sm">
                No cost-trend data{ops.available ? "" : " (ops unavailable)"}.
              </div>
            )}
          </div>
        </section>
        <section>
          <h2 className="mb-2 flex items-center gap-2 font-medium text-sm">
            <DollarSign className="size-4 text-[#00d4a0]" /> Cost by service
            (MTD)
          </h2>
          <div className="rounded-xl border bg-card">
            {infra.cost.services.slice(0, 12).map((s) => {
              const top = infra.cost.services[0]?.amount || 1;
              return (
                <div
                  className="relative flex items-center justify-between border-b px-4 py-2 text-sm last:border-0"
                  key={s.service}
                >
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 rounded-r bg-[#00d4a0]/10"
                    style={{ width: `${(s.amount / top) * 100}%` }}
                  />
                  <span className="relative truncate pr-3">{s.service}</span>
                  <span className="relative font-medium tabular-nums">
                    {money(s.amount, s.currency)}
                  </span>
                </div>
              );
            })}
            {infra.cost.services.length === 0 && (
              <div className="px-4 py-3 text-muted-foreground text-sm">
                No cost data yet.
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Databases — grouped by environment */}
      {allRds.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-2 font-medium text-sm">
            <Database className="size-4 text-[#00d4a0]" /> Databases (RDS)
          </h2>
          <div className="space-y-4">
            {opsAccounts
              .filter((a) => (a.rds ?? []).length > 0)
              .map((a) => (
                <div key={a.accountId}>
                  <div className="mb-1.5 flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
                    {envForAccount(a.accountId, a.label)}
                    <span className="font-mono lowercase opacity-70">
                      {a.accountId}
                    </span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {a.rds.map((r) => {
                      const ok = r.status.toLowerCase() === "available";
                      return (
                        <div
                          className={`rounded-lg border px-3 py-2 ${
                            ok ? "bg-card" : "border-red-500/40 bg-red-500/5"
                          }`}
                          key={r.id}
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={`size-2 rounded-full ${
                                ok ? "bg-[#00d4a0]" : "bg-red-500"
                              }`}
                            />
                            <span className="truncate font-medium text-sm">
                              {r.id}
                            </span>
                          </div>
                          <div className="mt-0.5 text-muted-foreground text-xs">
                            {r.engine} · {r.status}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
          </div>
        </section>
      )}

      {/* Resource inventory — per environment */}
      <section>
        <h2 className="mb-2 flex items-center gap-2 font-medium text-sm">
          <Boxes className="size-4 text-[#00d4a0]" /> Resource inventory
          <span className="font-normal text-muted-foreground">
            · by environment
          </span>
        </h2>
        <div className="space-y-6">
          {infra.environments.map((e) => (
            <div key={e.env}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span
                  className={`size-2.5 rounded-full ${
                    e.env === ENV_PROD ? "bg-[#00d4a0]" : "bg-sky-400"
                  }`}
                />
                <span className="font-medium text-sm">{e.env}</span>
                <span className="text-muted-foreground text-xs">
                  {e.resourceCount} resources · stages{" "}
                  {e.stages.join(", ") || "—"}
                </span>
              </div>
              <div className="grid gap-6 lg:grid-cols-2">
                <div>
                  <div className="mb-1.5 text-muted-foreground text-xs uppercase tracking-wide">
                    By service
                  </div>
                  <div className="rounded-xl border bg-card">
                    {e.byService.slice(0, 12).map((s) => {
                      const top = e.byService[0]?.count || 1;
                      return (
                        <div
                          className="relative flex items-center justify-between border-b px-4 py-2 text-sm last:border-0"
                          key={s.key}
                        >
                          <span
                            aria-hidden
                            className="absolute inset-y-0 left-0 rounded-r bg-[#00d4a0]/10"
                            style={{ width: `${(s.count / top) * 100}%` }}
                          />
                          <span className="relative truncate pr-3">
                            {s.key}
                          </span>
                          <span className="relative font-medium text-muted-foreground tabular-nums">
                            {s.count}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-6">
                  <div>
                    <div className="mb-1.5 text-muted-foreground text-xs uppercase tracking-wide">
                      By stage
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {e.byStage.map((s) => (
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm"
                          key={s.key}
                        >
                          <Layers className="size-3.5 text-muted-foreground" />
                          {s.key === "—" ? "untagged" : s.key}
                          <span className="text-muted-foreground tabular-nums">
                            {s.count}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1.5 text-muted-foreground text-xs uppercase tracking-wide">
                      By region
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {e.byRegion.map((s) => (
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm"
                          key={s.key}
                        >
                          {s.key === "—" ? "global" : s.key}
                          <span className="text-muted-foreground tabular-nums">
                            {s.count}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2 rounded-xl border bg-card p-3 text-sm">
          <GitFork className="size-4 text-[#00d4a0]" />
          <span>Linked code:</span>
          <a
            className="text-[#00d4a0] hover:underline"
            href="https://github.com/Apextech-Dev/reflex-connect-v2"
            rel="noreferrer"
            target="_blank"
          >
            Apextech-Dev/reflex-connect-v2 ↗
          </a>
        </div>
      </section>
    </div>
  );
}
