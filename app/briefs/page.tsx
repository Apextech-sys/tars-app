/**
 * /briefs — TARS twice-daily state-of-the-world briefings.
 *
 * Server component talking to Postgres directly (the established pattern).
 * Composition matches the rebuilt /infra and /knowledge pages: status banner,
 * hero stat tiles derived from the LATEST brief's structured BriefOutput, and
 * a day-grouped timeline of past briefs with per-row metric chips.
 *
 * The table is currently empty (0 rows) — the empty state is a designed,
 * teal-accented card, and every metric maps to a real column so it stays
 * honest the moment the first brief lands at 06:00 UTC.
 */

import { AlertTriangle, CheckCircle2, Clock, Newspaper } from "lucide-react";
import postgres from "postgres";
import type { ReactNode } from "react";
import {
  type BriefHeroStats,
  BriefHeroTiles,
} from "@/components/tars/brief-stat-tiles";
import {
  BriefTimeline,
  type TimelineRow,
} from "@/components/tars/brief-timeline";
import {
  type BriefOutputShape,
  composeLatency,
  kindLabel,
  parseBriefOutput,
} from "@/components/tars/brief-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let sqlClient: ReturnType<typeof postgres> | null = null;
function getSql() {
  if (sqlClient) {
    return sqlClient;
  }
  const url =
    process.env.WORKFLOW_POSTGRES_URL ??
    process.env.DATABASE_URL ??
    "postgres://tars_app:5bb16db4a6db588a087139b7225537595c0140791c0a037a@127.0.0.1:5433/tars_app";
  sqlClient = postgres(url, { max: 4, idle_timeout: 20, prepare: false });
  return sqlClient;
}

interface BriefListRow {
  id: string;
  date: string;
  kind: "morning" | "evening" | "adhoc";
  status: "pending" | "composing" | "ready" | "failed";
  summary: string | null;
  error_text: string | null;
  created_at: string;
  completed_at: string | null;
  act_insights: number;
  action_count: number;
  question_count: number;
  open_pr_count: number;
  reply_count: number;
}

interface LatestBriefRow {
  id: string;
  date: string;
  kind: "morning" | "evening" | "adhoc";
  status: "pending" | "composing" | "ready" | "failed";
  insights: unknown;
  source_context: unknown;
  error_text: string | null;
  created_at: string;
  completed_at: string | null;
}

async function loadBriefs(): Promise<BriefListRow[]> {
  try {
    const sql = getSql();
    const rows = await sql /* sql */`
      select
        b.id::text as id,
        to_char(b.date, 'YYYY-MM-DD') as date,
        b.kind,
        b.status,
        b.summary,
        b.error_text,
        to_char(b.created_at, 'YYYY-MM-DD HH24:MI UTC') as created_at,
        to_char(b.completed_at, 'YYYY-MM-DD HH24:MI UTC') as completed_at,
        coalesce((
          select count(*) from jsonb_array_elements(b.insights->'insights') e
          where e->>'severity' = 'act'
        ), 0)::int as act_insights,
        coalesce(jsonb_array_length(b.insights->'next_actions'), 0)::int as action_count,
        coalesce(jsonb_array_length(b.insights->'questions'), 0)::int as question_count,
        coalesce(jsonb_array_length(b.source_context->'open_prs'), 0)::int as open_pr_count,
        coalesce((
          select count(*) from brief_replies r where r.brief_id = b.id
        ), 0)::int as reply_count
      from briefs b
      order by b.created_at desc
      limit 60
    `;
    return rows as unknown as BriefListRow[];
  } catch (err) {
    console.error("/briefs list load failed", err);
    return [];
  }
}

async function loadLatestBrief(): Promise<LatestBriefRow | null> {
  try {
    const sql = getSql();
    const rows = await sql /* sql */`
      select
        id::text as id,
        to_char(date, 'YYYY-MM-DD') as date,
        kind, status, insights, source_context, error_text,
        to_char(created_at, 'YYYY-MM-DD HH24:MI UTC') as created_at,
        to_char(completed_at, 'YYYY-MM-DD HH24:MI UTC') as completed_at
      from briefs
      order by created_at desc
      limit 1
    `;
    if (rows.length === 0) {
      return null;
    }
    return rows[0] as unknown as LatestBriefRow;
  } catch (err) {
    console.error("/briefs latest load failed", err);
    return null;
  }
}

function toTimelineRow(b: BriefListRow): TimelineRow {
  return {
    id: b.id,
    date: b.date,
    kind: b.kind,
    status: b.status,
    summary: b.summary,
    errorText: b.error_text,
    stamp: b.completed_at ?? b.created_at,
    actInsights: b.act_insights,
    actionCount: b.action_count,
    questionCount: b.question_count,
    replyCount: b.reply_count,
  };
}

function buildHeroStats(
  latest: LatestBriefRow | null,
  out: BriefOutputShape | null,
  openPrCount: number
): BriefHeroStats {
  if (!(latest && out)) {
    return {
      latestLabel: "—",
      latestSub: "no briefs yet",
      shaunActions: 0,
      actInsights: 0,
      questions: 0,
      openPrs: 0,
      composeLatency: null,
    };
  }
  return {
    latestLabel: kindLabel(latest.kind),
    latestSub: latest.date,
    shaunActions: out.next_actions.filter((a) => a.owner === "shaun").length,
    actInsights: out.insights.filter((i) => i.severity === "act").length,
    questions: out.questions.length,
    openPrs: openPrCount,
    composeLatency:
      latest.status === "ready"
        ? composeLatency(latest.created_at, latest.completed_at)
        : null,
  };
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-[#00d4a0]/30 bg-[#00d4a0]/5 p-8 text-center">
      <Newspaper className="mx-auto size-8 text-[#00d4a0]" />
      <h2 className="mt-3 font-semibold text-lg">No briefs yet</h2>
      <p className="mx-auto mt-1 max-w-md text-muted-foreground text-sm">
        TARS composes a state-of-the-world briefing twice daily from the
        knowledge graph, projects.yaml, the audit log, and recent repo activity.
        The first one lands at{" "}
        <span className="font-medium text-foreground">06:00 UTC</span>.
      </p>
      <p className="mx-auto mt-4 max-w-md text-muted-foreground text-xs">
        When it arrives, you'll see extracted insights, the actions that need
        you, open questions, and the source context that drove it — all in here.
      </p>
    </div>
  );
}

function StatusBanner({ latest }: { latest: LatestBriefRow | null }) {
  let bannerClass = "border-amber-500/30 bg-amber-500/10 text-amber-400";
  let icon: ReactNode = <AlertTriangle className="size-4" />;
  let line = "No brief composed yet";

  if (latest) {
    if (latest.status === "ready") {
      bannerClass = "border-[#00d4a0]/30 bg-[#00d4a0]/10 text-[#00d4a0]";
      icon = <CheckCircle2 className="size-4" />;
      line = `Latest ${kindLabel(latest.kind).toLowerCase()} brief ready · ${latest.date}`;
    } else if (latest.status === "failed") {
      bannerClass = "border-red-500/30 bg-red-500/10 text-red-400";
      icon = <AlertTriangle className="size-4" />;
      line = `Latest brief failed to compose · ${latest.date}`;
    } else {
      bannerClass = "border-sky-500/30 bg-sky-500/10 text-sky-400";
      icon = <Clock className="size-4" />;
      line = `Brief ${latest.status}… · ${latest.date}`;
    }
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border px-4 py-3 text-sm ${bannerClass}`}
    >
      <span className="flex items-center gap-2 font-medium">
        {icon} {line}
      </span>
      <span className="text-muted-foreground">
        · cadence: morning 06:00 / evening 18:00 UTC
      </span>
      {latest?.status === "failed" && latest.error_text ? (
        <span className="text-muted-foreground">
          · {latest.error_text.slice(0, 120)}
        </span>
      ) : null}
    </div>
  );
}

export default async function BriefsPage() {
  const [briefs, latest] = await Promise.all([loadBriefs(), loadLatestBrief()]);
  const latestOut = latest ? parseBriefOutput(latest.insights) : null;
  const latestOpenPrCount = briefs.find(
    (b) => b.id === latest?.id
  )?.open_pr_count;
  const heroStats = buildHeroStats(latest, latestOut, latestOpenPrCount ?? 0);
  const timelineRows = briefs.map(toTimelineRow);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <header>
        <h1 className="flex items-center gap-2 font-semibold text-xl">
          <Newspaper className="size-5 text-[#00d4a0]" /> Briefs
        </h1>
        <p className="max-w-3xl text-muted-foreground text-sm">
          Twice-daily situation reports composed from the TARS graph,
          projects.yaml, the audit log, and recent repo activity — read the
          structured report, jump to the actions that need you, and reply to
          thread it back into chat.
        </p>
      </header>

      {briefs.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <StatusBanner latest={latest} />
          <BriefHeroTiles stats={heroStats} />
          <BriefTimeline rows={timelineRows} />
        </>
      )}
    </div>
  );
}
