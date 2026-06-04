import { sql } from "drizzle-orm";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Cog,
  GitBranch,
  Plug,
  Send,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { BehaviourModelsSection } from "@/components/settings/behaviour-models";
import { IntegrationHealthSection } from "@/components/settings/integration-health";
import { NotificationsRoutingSection } from "@/components/settings/notifications-routing";
import { ProjectsRegistrySection } from "@/components/settings/projects-registry";
import {
  SettingsStatTile,
  type Tone,
} from "@/components/settings/settings-stat-tile";
import { db } from "@/lib/db";
import { repoSettings, webhookEvents } from "@/lib/db/tars-schema";
import { getAppSetting } from "@/lib/tars/app-settings";

export const dynamic = "force-dynamic";

// Required integrations whose absence flips the wiring banner to a hard state.
const REQUIRED_ENV: { label: string; vars: string[] }[] = [
  { label: "GitHub", vars: ["GH_TOKEN", "GITHUB_WEBHOOK_SECRET"] },
  { label: "Linear", vars: ["LINEAR_API_KEY", "LINEAR_WEBHOOK_SECRET"] },
  { label: "OpenAI", vars: ["OPENAI_API_KEY"] },
  { label: "Knowledge graph", vars: ["TARS_GRAPH_URL"] },
  { label: "Postgres", vars: ["DATABASE_URL"] },
];

const OPTIONAL_ENV: { label: string; vars: string[] }[] = [
  {
    label: "Slack",
    vars: ["SLACK_BOT_TOKEN", "SLACK_USER_TOKEN", "SLACK_SIGNING_SECRET"],
  },
  { label: "Review worker", vars: ["TARS_WORKER_CALLBACK_SECRET"] },
];

function envPresent(name: string): boolean {
  const v = process.env[name];
  return typeof v === "string" && v.trim().length > 0;
}

function groupConnected(group: { vars: string[] }): boolean {
  return group.vars.every((v) => envPresent(v));
}

interface NotificationsSetting {
  enabled: boolean;
  severity_threshold: string;
}

function SectionShell({
  title,
  description,
  icon: Icon,
  accent,
  children,
  id,
}: {
  title: string;
  description: string;
  icon: typeof Cog;
  accent?: boolean;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section className="space-y-4" id={id}>
      <div>
        <h2 className="flex items-center gap-2 font-semibold text-lg">
          <Icon className={accent ? "size-4 text-[#00d4a0]" : "size-4"} />
          {title}
        </h2>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      {children}
    </section>
  );
}

export default async function SettingsPage() {
  const allEnv = [...REQUIRED_ENV, ...OPTIONAL_ENV];
  const connectedCount = allEnv.filter(groupConnected).length;
  const totalIntegrations = allEnv.length;
  const missingRequired = REQUIRED_ENV.filter((g) => !groupConnected(g));

  const [repoRows, webhook24h] = await Promise.all([
    db
      .select({ webhookEnabled: repoSettings.webhookEnabled })
      .from(repoSettings),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(webhookEvents)
      .where(sql`${webhookEvents.createdAt} > now() - interval '24 hours'`),
  ]);

  const reposUnderReview = repoRows.filter((r) => r.webhookEnabled).length;
  const totalRepos = repoRows.length;
  const deliveries24h = webhook24h[0]?.count ?? 0;

  const notifications = (await getAppSetting<NotificationsSetting>(
    "notifications"
  )) ?? {
    enabled: false,
    severity_threshold: "warn",
  };

  // Banner tone — precomputed to avoid nested ternaries in JSX.
  const alertingActive = notifications.enabled;

  let bannerClass = "border-[#00d4a0]/30 bg-[#00d4a0]/10 text-[#00d4a0]";
  let bannerIcon: ReactNode = <CheckCircle2 className="size-4" />;
  let bannerText = "All integrations connected · alerting active";
  if (missingRequired.length > 0) {
    bannerClass = "border-red-500/30 bg-red-500/10 text-red-400";
    bannerIcon = <AlertTriangle className="size-4" />;
    const names = missingRequired.map((g) => g.label).join(", ");
    bannerText = `${missingRequired.length} required integration${
      missingRequired.length === 1 ? "" : "s"
    } not configured: ${names}`;
  } else if (!alertingActive) {
    bannerClass = "border-amber-500/30 bg-amber-500/10 text-amber-400";
    bannerIcon = <AlertTriangle className="size-4" />;
    bannerText = "Integrations connected — but notifications are off";
  }

  // Hero tile tones.
  let integrationsTone: Tone = "good";
  if (missingRequired.length > 0) {
    integrationsTone = "bad";
  } else if (connectedCount < totalIntegrations) {
    integrationsTone = "warn";
  }

  const reposTone: Tone = reposUnderReview > 0 ? "good" : "warn";
  const deliveriesTone: Tone = deliveries24h > 0 ? "good" : "warn";
  const notifTone: Tone = notifications.enabled ? "good" : "warn";
  const notifValue = notifications.enabled ? "On" : "Off";
  const notifSub = `${notifications.severity_threshold}+ threshold`;

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-4 md:p-6">
      <header>
        <h1 className="flex items-center gap-2 font-semibold text-xl">
          <Cog className="size-5 text-[#00d4a0]" /> Settings
        </h1>
        <p className="max-w-3xl text-muted-foreground text-sm">
          Verify TARS is correctly wired and tune how it behaves and alerts you
          — integration health, the repos under review, models, and where alerts
          are routed. Credentials show presence only, never their values.
        </p>
      </header>

      {/* System wiring banner */}
      <div
        className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border px-4 py-3 text-sm ${bannerClass}`}
      >
        <span className="flex items-center gap-2 font-medium">
          {bannerIcon} {bannerText}
        </span>
        <span className="text-muted-foreground">
          · {connectedCount}/{totalIntegrations} integrations ·{" "}
          {reposUnderReview} repo{reposUnderReview === 1 ? "" : "s"} under
          review
        </span>
      </div>

      {/* Hero stat row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SettingsStatTile
          icon={Plug}
          label="Integrations connected"
          sub={
            missingRequired.length > 0
              ? `${missingRequired.length} required missing`
              : "all required present"
          }
          tone={integrationsTone}
          value={
            <>
              {connectedCount}
              <span className="text-base text-muted-foreground">
                /{totalIntegrations}
              </span>
            </>
          }
        />
        <SettingsStatTile
          icon={GitBranch}
          label="Repos under review"
          sub={`of ${totalRepos} registered`}
          tone={reposTone}
          value={reposUnderReview}
        />
        <SettingsStatTile
          icon={Send}
          label="Webhook deliveries · 24h"
          sub="ingestion alive"
          tone={deliveriesTone}
          value={deliveries24h.toLocaleString()}
        />
        <SettingsStatTile
          icon={Bell}
          label="Notifications"
          sub={notifSub}
          tone={notifTone}
          value={notifValue}
        />
      </div>

      <SectionShell
        accent
        description="Which external systems TARS is connected to — credential presence and last activity, surfaced in-app. Expand a tile to see which slots are filled."
        icon={Plug}
        title="Integration health"
      >
        <IntegrationHealthSection />
      </SectionShell>

      <SectionShell
        description="Every repo TARS watches, its delivery activity, and inline review controls — backed by the repo_settings table."
        icon={GitBranch}
        id="projects-registry"
        title="Projects registry & review controls"
      >
        <ProjectsRegistrySection />
      </SectionShell>

      <SectionShell
        description="Global model defaults for the chat assistant and the PR review engine."
        icon={SlidersHorizontal}
        title="Behaviour & models"
      >
        <BehaviourModelsSection />
      </SectionShell>

      <SectionShell
        description="Browser push alerts plus where escalations are routed across Slack and Linear."
        icon={Bell}
        title="Notifications & routing"
      >
        <NotificationsRoutingSection />
      </SectionShell>

      <SectionShell
        description="TARS agent departments and profiles are configured in TARS core (not in this app)."
        icon={Users}
        title="Departments & profiles"
      >
        <div className="flex items-start gap-2 rounded-xl border bg-card px-4 py-3 text-muted-foreground text-sm">
          <Users className="mt-0.5 size-4 shrink-0" />
          <span>
            Department and agent-profile configuration lives in TARS core state,
            not this dashboard. No profile data source is wired to this app, so
            nothing is shown here rather than fabricated placeholders.
          </span>
        </div>
      </SectionShell>
    </div>
  );
}
