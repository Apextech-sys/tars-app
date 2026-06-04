import { ExternalLink, GitPullRequest, ScanSearch } from "lucide-react";

export function SourceChips({
  owner,
  prNumber,
  prSha,
  repo,
  runId,
}: {
  owner: string;
  prNumber: number;
  prSha?: string | null;
  repo: string;
  runId: string;
}) {
  const githubUrl = `https://github.com/${owner}/${repo}/pull/${prNumber}`;
  const runUrl = `/pr-runs/${encodeURIComponent(runId)}`;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 font-medium font-mono">
        <GitPullRequest className="size-3 text-[#00d4a0]" />
        {owner}/{repo}
        <span className="text-muted-foreground">#{prNumber}</span>
      </span>
      {prSha ? (
        <span className="rounded-md border bg-muted/40 px-2 py-1 font-mono text-muted-foreground">
          {prSha.slice(0, 7)}
        </span>
      ) : null}
      <a
        className="inline-flex min-h-[28px] items-center gap-1 rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        href={runUrl}
      >
        <ScanSearch className="size-3" />
        Run detail
      </a>
      <a
        className="inline-flex min-h-[28px] items-center gap-1 rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        href={githubUrl}
        rel="noopener noreferrer"
        target="_blank"
      >
        <ExternalLink className="size-3" />
        GitHub
      </a>
    </div>
  );
}
