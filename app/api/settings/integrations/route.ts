import { desc, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { webhookEvents } from "@/lib/db/tars-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IntegrationStatus = "connected" | "not-configured" | "error";
type IntegrationGroup =
  | "Source control"
  | "Comms"
  | "AI"
  | "Knowledge"
  | "Platform";

interface CredentialSlot {
  label: string;
  present: boolean;
}

interface IntegrationHealth {
  key: string;
  label: string;
  group: IntegrationGroup;
  status: IntegrationStatus;
  detail: string;
  required: boolean;
  credentials: CredentialSlot[];
  deepLink: string | null;
  lastSyncAt: string | null;
}

/**
 * Reports which external systems TARS is wired to. SECURITY HARD RULE: this
 * route serializes ONLY presence booleans + coarse status, NEVER any secret
 * value. Source is server-side env-var presence; webhook_events supplies the
 * GitHub/Linear last-delivery timestamp where one exists.
 */
function present(name: string): boolean {
  const v = process.env[name];
  return typeof v === "string" && v.trim().length > 0;
}

export async function GET(): Promise<NextResponse> {
  // Latest webhook delivery overall — the only stored activity signal we have
  // (GitHub deliveries land in webhook_events; Linear shares the table).
  let lastDelivery: string | null = null;
  try {
    const rows = await db
      .select({ createdAt: webhookEvents.createdAt })
      .from(webhookEvents)
      .orderBy(desc(webhookEvents.createdAt))
      .limit(1);
    lastDelivery = rows[0]?.createdAt?.toISOString() ?? null;
  } catch {
    lastDelivery = null;
  }

  // Linear-specific last activity (events carrying the linear delivery shape
  // are stored alongside github; fall back to overall if not separable).
  let linearLast: string | null = null;
  try {
    const rows = await db
      .select({ createdAt: webhookEvents.createdAt })
      .from(webhookEvents)
      .where(sql`${webhookEvents.eventType} ilike 'linear%'`)
      .orderBy(desc(webhookEvents.createdAt))
      .limit(1);
    linearLast = rows[0]?.createdAt?.toISOString() ?? null;
  } catch {
    linearLast = null;
  }

  const githubCreds: CredentialSlot[] = [
    { label: "Access token", present: present("GH_TOKEN") },
    { label: "Webhook secret", present: present("GITHUB_WEBHOOK_SECRET") },
  ];
  const linearCreds: CredentialSlot[] = [
    { label: "API key", present: present("LINEAR_API_KEY") },
    { label: "Webhook secret", present: present("LINEAR_WEBHOOK_SECRET") },
  ];
  const slackCreds: CredentialSlot[] = [
    { label: "Bot token", present: present("SLACK_BOT_TOKEN") },
    { label: "User token", present: present("SLACK_USER_TOKEN") },
    { label: "Signing secret", present: present("SLACK_SIGNING_SECRET") },
  ];
  const openaiCreds: CredentialSlot[] = [
    { label: "API key", present: present("OPENAI_API_KEY") },
  ];
  const graphCreds: CredentialSlot[] = [
    { label: "Graph URL", present: present("TARS_GRAPH_URL") },
  ];
  const workerCreds: CredentialSlot[] = [
    {
      label: "Callback secret",
      present: present("TARS_WORKER_CALLBACK_SECRET"),
    },
  ];
  const postgresCreds: CredentialSlot[] = [
    {
      label: "Connection URL",
      present: present("DATABASE_URL") || present("WORKFLOW_POSTGRES_URL"),
    },
  ];

  function statusFor(creds: CredentialSlot[]): IntegrationStatus {
    if (creds.every((c) => c.present)) {
      return "connected";
    }
    if (creds.some((c) => c.present)) {
      return "error";
    }
    return "not-configured";
  }

  function detailFor(creds: CredentialSlot[]): string {
    const have = creds.filter((c) => c.present).length;
    if (have === creds.length) {
      return `${creds.map((c) => c.label.toLowerCase()).join(" + ")} present`;
    }
    if (have === 0) {
      return "no credentials configured";
    }
    return `${have}/${creds.length} credentials present`;
  }

  const integrations: IntegrationHealth[] = [
    {
      key: "github",
      label: "GitHub",
      group: "Source control",
      status: statusFor(githubCreds),
      detail: detailFor(githubCreds),
      required: true,
      credentials: githubCreds,
      deepLink: "https://github.com/settings/installations",
      lastSyncAt: lastDelivery,
    },
    {
      key: "linear",
      label: "Linear",
      group: "Source control",
      status: statusFor(linearCreds),
      detail: detailFor(linearCreds),
      required: true,
      credentials: linearCreds,
      deepLink: "https://linear.app/settings/api",
      lastSyncAt: linearLast,
    },
    {
      key: "slack",
      label: "Slack",
      group: "Comms",
      status: statusFor(slackCreds),
      detail: detailFor(slackCreds),
      required: false,
      credentials: slackCreds,
      deepLink: "https://api.slack.com/apps",
      lastSyncAt: null,
    },
    {
      key: "openai",
      label: "OpenAI",
      group: "AI",
      status: statusFor(openaiCreds),
      detail: detailFor(openaiCreds),
      required: true,
      credentials: openaiCreds,
      deepLink: "https://platform.openai.com/api-keys",
      lastSyncAt: null,
    },
    {
      key: "graph",
      label: "Knowledge graph",
      group: "Knowledge",
      status: statusFor(graphCreds),
      detail: detailFor(graphCreds),
      required: true,
      credentials: graphCreds,
      deepLink: null,
      lastSyncAt: null,
    },
    {
      key: "worker",
      label: "Review worker",
      group: "Platform",
      status: statusFor(workerCreds),
      detail: detailFor(workerCreds),
      required: false,
      credentials: workerCreds,
      deepLink: null,
      lastSyncAt: null,
    },
    {
      key: "postgres",
      label: "Postgres",
      group: "Platform",
      status: statusFor(postgresCreds),
      detail: detailFor(postgresCreds),
      required: true,
      credentials: postgresCreds,
      deepLink: null,
      lastSyncAt: null,
    },
  ];

  const connected = integrations.filter((i) => i.status === "connected").length;
  const requiredMissing = integrations.filter(
    (i) => i.required && i.status !== "connected"
  ).length;

  return NextResponse.json({
    integrations,
    connected,
    total: integrations.length,
    requiredMissing,
  });
}
