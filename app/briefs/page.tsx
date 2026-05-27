/**
 * /briefs — list of recent TARS briefs.
 *
 * This is a server component that talks to Postgres directly. Composition
 * matches the rest of the dashboard (Tailwind utility classes, lucide
 * icons, links to detail pages). Status badges call out anything that
 * hasn't reached "ready" so a stuck compose is visible at a glance.
 */

import Link from "next/link";
import postgres from "postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let sqlClient: ReturnType<typeof postgres> | null = null;
function getSql() {
  if (sqlClient) return sqlClient;
  const url =
    process.env.WORKFLOW_POSTGRES_URL ??
    process.env.DATABASE_URL ??
    "postgres://tars_app:5bb16db4a6db588a087139b7225537595c0140791c0a037a@127.0.0.1:5433/tars_app";
  sqlClient = postgres(url, { max: 4, idle_timeout: 20, prepare: false });
  return sqlClient;
}

interface BriefRow {
  id: string;
  date: string;
  kind: "morning" | "evening" | "adhoc";
  status: "pending" | "composing" | "ready" | "failed";
  summary: string | null;
  run_id: string;
  error_text: string | null;
  created_at: string;
  completed_at: string | null;
}

async function loadBriefs(): Promise<BriefRow[]> {
  try {
    const sql = getSql();
    const rows = await sql/* sql */`
      select id::text as id, to_char(date, 'YYYY-MM-DD') as date,
             kind, status, summary, run_id, error_text,
             to_char(created_at, 'YYYY-MM-DD HH24:MI UTC') as created_at,
             to_char(completed_at, 'YYYY-MM-DD HH24:MI UTC') as completed_at
      from briefs
      order by created_at desc
      limit 30
    `;
    return rows as unknown as BriefRow[];
  } catch (err) {
    console.error("/briefs list load failed", err);
    return [];
  }
}

function statusBadge(status: BriefRow["status"]) {
  const map: Record<BriefRow["status"], string> = {
    pending:
      "bg-amber-500/10 text-amber-300 border border-amber-500/30",
    composing:
      "bg-blue-500/10 text-blue-300 border border-blue-500/30",
    ready: "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30",
    failed: "bg-rose-500/10 text-rose-300 border border-rose-500/30",
  };
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full uppercase tracking-wide ${map[status]}`}
    >
      {status}
    </span>
  );
}

function kindEmoji(kind: BriefRow["kind"]): string {
  if (kind === "morning") return "Morning";
  if (kind === "evening") return "Evening";
  return "Adhoc";
}

export default async function BriefsPage() {
  const briefs = await loadBriefs();
  return (
    <div className="pointer-events-auto min-h-screen w-full text-zinc-100 px-4 md:px-6 py-6 md:py-10">
      <div className="max-w-3xl mx-auto">
        <header className="mb-8">
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">TARS Briefs</h1>
          <p className="text-sm text-zinc-400 mt-2">
            Twice-daily situation reports composed from the TARS graph,
            projects.yaml, audit log, and recent repo activity.
          </p>
        </header>

        {briefs.length === 0 ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-6 text-sm text-zinc-400">
            No briefs yet. The first one lands at 06:00 UTC tomorrow, or you
            can trigger one manually:
            <pre className="mt-3 p-3 rounded bg-black/40 text-xs text-zinc-300 overflow-x-auto">
              {`curl -X POST http://localhost:3001/api/tars/briefs \\\n  -H 'content-type: application/json' \\\n  -d '{"kind":"morning","authToken":"$TARS_INTERNAL_SECRET"}'`}
            </pre>
          </div>
        ) : (
          <ul className="space-y-3">
            {briefs.map((b) => (
              <li
                key={b.id}
                className="rounded-lg border border-zinc-800 bg-zinc-950/40 hover:bg-zinc-900/50 transition-colors"
              >
                <Link
                  href={`/briefs/${b.id}`}
                  className="block p-4 focus:outline-none focus:ring-2 focus:ring-zinc-700 rounded-lg"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-zinc-200">
                        {kindEmoji(b.kind)} — {b.date}
                      </span>
                      {statusBadge(b.status)}
                    </div>
                    <span className="text-xs text-zinc-500 shrink-0">
                      {b.completed_at ?? b.created_at}
                    </span>
                  </div>
                  <p className="text-sm text-zinc-300 line-clamp-2">
                    {b.summary ??
                      (b.status === "failed"
                        ? `(failed: ${b.error_text?.slice(0, 200) ?? "no detail"})`
                        : "Composing…")}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
