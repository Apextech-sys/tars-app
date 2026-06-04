/**
 * BriefSourceContext — the "What drove this brief" panel.
 *
 * Surfaces the grounding the brief workflow gathered (graph snapshot, audit
 * window, repo activity, GitHub PRs/issues) so the brief is auditable in-app,
 * not a black box. PR/issue urls are SECONDARY deep-links (small icon); the
 * data is shown in-app first. Whole panel collapses behind a single <details>.
 *
 * Pure presentational / server-renderable.
 */

import {
  ArrowUpRight,
  Database,
  GitCommitHorizontal,
  ScrollText,
} from "lucide-react";
import type { SourceContextShape } from "./brief-types";

function topEntries(
  rec: Record<string, number> | undefined,
  limit: number
): { key: string; value: number }[] {
  if (!rec) {
    return [];
  }
  return Object.entries(rec)
    .map(([key, value]) => ({ key, value: Number(value) || 0 }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

function sumValues(rec: Record<string, number> | undefined): number {
  if (!rec) {
    return 0;
  }
  return Object.values(rec).reduce((n, v) => n + (Number(v) || 0), 0);
}

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

function BarList({ rows }: { rows: { key: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div className="space-y-0.5" key={r.key}>
          <div className="flex items-center justify-between text-xs">
            <span className="truncate text-muted-foreground" title={r.key}>
              {r.key}
            </span>
            <span className="ml-2 shrink-0 font-medium tabular-nums">
              {r.value}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted/40">
            <div
              className="h-full rounded-full bg-[#00d4a0]/70"
              style={{ width: `${Math.max(4, (r.value / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function SubCard({
  title,
  icon: Icon,
  available,
  children,
}: {
  title: string;
  icon: typeof Database;
  available: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 font-medium text-sm">
          <Icon className="size-4 text-[#00d4a0]" /> {title}
        </div>
        {available ? null : (
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-400 text-xs">
            unavailable
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

export function BriefSourceContext({ ctx }: { ctx: SourceContextShape }) {
  const avail = ctx._availability ?? {};
  const nodeRows = topEntries(ctx.graph?.node_counts, 6);
  const totalNodes = sumValues(ctx.graph?.node_counts);
  const totalEdges = sumValues(ctx.graph?.edge_counts);
  const outcomeRows = topEntries(ctx.audit_window?.by_outcome, 6);
  const auditTotal = ctx.audit_window?.total_entries ?? 0;
  const repoRows = (ctx.recent_repo_activity ?? [])
    .slice()
    .sort((a, b) => b.commits - a.commits)
    .slice(0, 6)
    .map((r) => ({ key: r.repo, value: r.commits }));
  const openPrs = ctx.open_prs ?? [];
  const issues = ctx.recent_issues ?? [];

  const graphAvailable = avail.graph !== false && totalNodes > 0;
  const auditAvailable = avail.audit !== false && auditTotal > 0;
  const repoAvailable = repoRows.length > 0;
  const githubAvailable =
    avail.github_prs !== false || openPrs.length > 0 || issues.length > 0;

  return (
    <details
      className="group rounded-xl border bg-card/40 p-4"
      id="source-context"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <span className="flex items-center gap-2 font-semibold text-base">
          <ScrollText className="size-4 text-[#00d4a0]" /> What drove this brief
        </span>
        <span className="text-muted-foreground text-xs">
          <span className="group-open:hidden">Show grounding</span>
          <span className="hidden group-open:inline">Hide</span>
        </span>
      </summary>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SubCard available={graphAvailable} icon={Database} title="Graph">
          <div className="space-y-1">
            <StatRow label="Nodes" value={totalNodes} />
            <StatRow label="Edges" value={totalEdges} />
            <StatRow label="Projects" value={ctx.graph?.project_count ?? 0} />
          </div>
          {nodeRows.length > 0 ? (
            <div className="mt-3 border-foreground/10 border-t pt-3">
              <BarList rows={nodeRows} />
            </div>
          ) : null}
        </SubCard>

        <SubCard
          available={auditAvailable}
          icon={ScrollText}
          title="Audit window"
        >
          <StatRow label="Total entries" value={auditTotal} />
          {outcomeRows.length > 0 ? (
            <div className="mt-3 border-foreground/10 border-t pt-3">
              <BarList rows={outcomeRows} />
            </div>
          ) : (
            <p className="mt-2 text-muted-foreground text-xs">
              No outcomes in window.
            </p>
          )}
        </SubCard>

        <SubCard
          available={repoAvailable}
          icon={GitCommitHorizontal}
          title="Repo activity"
        >
          {repoRows.length > 0 ? (
            <BarList rows={repoRows} />
          ) : (
            <p className="text-muted-foreground text-xs">No recent commits.</p>
          )}
        </SubCard>

        <SubCard available={githubAvailable} icon={ArrowUpRight} title="GitHub">
          <div className="space-y-1">
            <StatRow label="Open PRs" value={openPrs.length} />
            <StatRow label="Recent issues" value={issues.length} />
          </div>
          {openPrs.length > 0 ? (
            <ul className="mt-3 space-y-1.5 border-foreground/10 border-t pt-3">
              {openPrs.slice(0, 3).map((pr) => (
                <li
                  className="flex items-center justify-between gap-2 text-xs"
                  key={`${pr.repo}-${pr.number}`}
                >
                  <span className="truncate" title={pr.title}>
                    <span className="font-mono text-muted-foreground">
                      #{pr.number}
                    </span>{" "}
                    {pr.title || pr.repo}
                  </span>
                  {pr.url ? (
                    <a
                      className="shrink-0 text-muted-foreground transition-colors hover:text-[#00d4a0]"
                      href={pr.url}
                      rel="noreferrer noopener"
                      target="_blank"
                      title="Open PR on GitHub"
                    >
                      <ArrowUpRight className="size-3.5" />
                    </a>
                  ) : null}
                </li>
              ))}
              {openPrs.length > 3 ? (
                <li className="text-muted-foreground text-xs">
                  + {openPrs.length - 3} more
                </li>
              ) : null}
            </ul>
          ) : null}
        </SubCard>
      </div>
    </details>
  );
}
