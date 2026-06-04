/**
 * Server-side client for the tars-graph AWS endpoints.
 *
 * Talks to the tars-graph HTTP service (Dokploy-internal) via TARS_GRAPH_URL —
 * same env the knowledge/blast-radius clients use. NO VM-102 dependency.
 *
 * Endpoints consumed (read-only, account 140138661997 = dev+staging scope):
 *   GET /aws/accounts   -> { available, accounts: [...] }
 *   GET /aws/resources  -> { available, count, resources: [...] }
 *   GET /aws/cost       -> { available, total, currency, period, services: [...] }
 *
 * Degrades gracefully: any failure yields an "unavailable" shape so the UI
 * shows an empty/soft state instead of throwing.
 */

const TARS_GRAPH_URL = (process.env.TARS_GRAPH_URL ?? "").replace(/\/$/, "");
const TIMEOUT_MS = 12_000;

export interface AwsAccount {
  accountId: string;
  alias: string;
  resourceCount: number;
}
export interface AwsResource {
  arn: string;
  service: string;
  type: string;
  region: string;
  stage: string;
  app: string;
  name: string;
}
export interface AwsCostService {
  service: string;
  amount: number;
  currency: string;
}
export interface CountRow {
  key: string;
  count: number;
}
export interface InfraSummary {
  available: boolean;
  accounts: AwsAccount[];
  totalResources: number;
  byService: CountRow[];
  byStage: CountRow[];
  byRegion: CountRow[];
  cost: {
    available: boolean;
    total: number;
    currency: string;
    period: { start: string; end: string };
    services: AwsCostService[];
  };
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

function tally(rows: AwsResource[], key: keyof AwsResource): CountRow[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = (r[key] || "—").toString();
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([k, count]) => ({ key: k, count }))
    .sort((a, b) => b.count - a.count);
}

export async function getInfra(): Promise<InfraSummary> {
  const [accRaw, resRaw, costRaw] = await Promise.all([
    graphFetch("/aws/accounts"),
    graphFetch("/aws/resources"),
    graphFetch("/aws/cost"),
  ]);

  const accData = accRaw as {
    available?: boolean;
    accounts?: AwsAccount[];
  } | null;
  const resData = resRaw as {
    available?: boolean;
    resources?: AwsResource[];
  } | null;
  const costData = costRaw as {
    available?: boolean;
    total?: number;
    currency?: string;
    period?: { start: string; end: string };
    services?: AwsCostService[];
  } | null;

  const available = Boolean(accData || resData || costData);
  const resources = Array.isArray(resData?.resources) ? resData.resources : [];

  return {
    available,
    accounts: Array.isArray(accData?.accounts) ? accData.accounts : [],
    totalResources: resources.length,
    byService: tally(resources, "service"),
    byStage: tally(resources, "stage"),
    byRegion: tally(resources, "region"),
    cost: {
      available: Boolean(costData) && costData?.available !== false,
      total: typeof costData?.total === "number" ? costData.total : 0,
      currency: costData?.currency ?? "USD",
      period: costData?.period ?? { start: "", end: "" },
      services: Array.isArray(costData?.services) ? costData.services : [],
    },
    notes: available ? undefined : "tars-graph unreachable",
  };
}

export interface OpsAccount {
  label: string;
  accountId: string;
  alarms: {
    OK: number;
    ALARM: number;
    INSUFFICIENT_DATA?: number;
    firing: { name: string; reason: string }[];
  };
  services: {
    cluster: string;
    name: string;
    running: number;
    desired: number;
    status: string;
  }[];
  rds: { id: string; status: string; engine: string }[];
  costTrend: { date: string; amount: number }[];
}
export interface OpsView {
  available: boolean;
  accounts: OpsAccount[];
  notes?: string;
}

export async function getOps(): Promise<OpsView> {
  if (!TARS_GRAPH_URL) {
    return { available: false, accounts: [], notes: "TARS_GRAPH_URL unset" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000); // live boto3 fan-out
  try {
    const res = await fetch(`${TARS_GRAPH_URL}/aws/ops`, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      return { available: false, accounts: [], notes: `ops ${res.status}` };
    }
    const data = (await res.json()) as Partial<OpsView>;
    return {
      available: data.available !== false,
      accounts: Array.isArray(data.accounts) ? data.accounts : [],
      notes: data.notes,
    };
  } catch {
    return { available: false, accounts: [], notes: "ops unreachable" };
  } finally {
    clearTimeout(timer);
  }
}
