"use client";

import {
  BookOpen,
  ExternalLink,
  FileCode2,
  GitFork,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Ticket as TicketIcon,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

interface DocSummary {
  notionId: string;
  title: string;
  url: string;
  lastEdited: string;
  ingestedAt: string;
  fileCount: number;
  ticketCount: number;
  repoCount: number;
}

interface LinkedFile {
  repo: string;
  path: string;
}
interface LinkedTicket {
  identifier: string;
  team: string;
  title: string;
  url: string;
}
interface LinkedRepo {
  fullName: string;
  url: string;
}

interface DocDetail {
  available: boolean;
  found: boolean;
  doc: {
    notionId: string;
    title: string;
    url: string;
    lastEdited: string;
    ingestedAt: string;
  } | null;
  files: LinkedFile[];
  tickets: LinkedTicket[];
  repos: LinkedRepo[];
}

function githubFileUrl(repo: string, path: string): string {
  return `https://github.com/${repo}/blob/main/${path}`;
}

function relativeTime(iso: string): string {
  if (!iso) {
    return "—";
  }
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) {
    return `${s}s ago`;
  }
  const m = Math.floor(s / 60);
  if (m < 60) {
    return `${m}m ago`;
  }
  const h = Math.floor(m / 60);
  if (h < 24) {
    return `${h}h ago`;
  }
  return `${Math.floor(h / 24)}d ago`;
}

/** A pill summarising a doc's link counts. */
function LinkCounts({ doc }: { doc: DocSummary }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="inline-flex items-center gap-1 rounded-full border border-[#00d4a0]/30 bg-[#00d4a0]/10 px-2 py-0.5 text-[#00d4a0]">
        <FileCode2 className="size-3" />
        {doc.fileCount}
      </span>
      <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-sky-400">
        <TicketIcon className="size-3" />
        {doc.ticketCount}
      </span>
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-400">
        <GitFork className="size-3" />
        {doc.repoCount}
      </span>
    </div>
  );
}

function teamColor(team: string): string {
  const map: Record<string, string> = {
    REF: "border-purple-500/30 bg-purple-500/10 text-purple-400",
    APE: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    PLA: "border-sky-500/30 bg-sky-500/10 text-sky-400",
  };
  return map[team] ?? "border-zinc-600 bg-zinc-800/50 text-zinc-300";
}

function DocDetailPanel({
  detail,
  loading,
  onClose,
}: {
  detail: DocDetail | null;
  loading: boolean;
  onClose: () => void;
}) {
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center py-24">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!detail?.doc) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
        <BookOpen className="size-8 opacity-40" />
        <p className="text-sm">Select a doc to see its linked code & tickets</p>
      </div>
    );
  }

  const { doc, files, tickets, repos } = detail;
  const linkTotal = files.length + tickets.length + repos.length;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-border border-b px-5 py-4">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <Sparkles className="size-3.5 text-[#00d4a0]" />
            Notion doc · ingested {relativeTime(doc.ingestedAt)}
          </div>
          <h2 className="break-words font-semibold text-lg leading-tight">
            {doc.title}
          </h2>
          <a
            className="inline-flex items-center gap-1 text-[#00d4a0] text-xs hover:underline"
            href={doc.url}
            rel="noreferrer"
            target="_blank"
          >
            Open in Notion
            <ExternalLink className="size-3" />
          </a>
        </div>
        <Button
          aria-label="Close detail"
          className="min-h-[36px] min-w-[36px] shrink-0 p-0 lg:hidden"
          onClick={onClose}
          size="sm"
          variant="ghost"
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
        {linkTotal === 0 && (
          <p className="text-muted-foreground text-sm">
            No explicit code, ticket, or repo references found in this doc.
          </p>
        )}

        {/* Linked code files */}
        {files.length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center gap-2 font-medium text-sm">
              <FileCode2 className="size-4 text-[#00d4a0]" />
              Linked code
              <Badge className="ml-1" variant="secondary">
                {files.length}
              </Badge>
            </div>
            <ul className="space-y-1.5">
              {files.map((f) => (
                <li key={`${f.repo}:${f.path}`}>
                  <a
                    className="group flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 transition-colors hover:border-[#00d4a0]/50 hover:bg-accent/40"
                    href={githubFileUrl(f.repo, f.path)}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm">{f.path}</p>
                      <p className="truncate text-muted-foreground text-xs">
                        {f.repo}
                      </p>
                    </div>
                    <ExternalLink className="size-3.5 shrink-0 text-muted-foreground group-hover:text-[#00d4a0]" />
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Linked Linear tickets */}
        {tickets.length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center gap-2 font-medium text-sm">
              <TicketIcon className="size-4 text-sky-400" />
              Linked tickets
              <Badge className="ml-1" variant="secondary">
                {tickets.length}
              </Badge>
            </div>
            <ul className="space-y-1.5">
              {tickets.map((t) => (
                <li key={t.identifier}>
                  <a
                    className="group flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2 transition-colors hover:border-sky-500/50 hover:bg-accent/40"
                    href={t.url || "#"}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-2 py-0.5 font-mono text-xs",
                        teamColor(t.team)
                      )}
                    >
                      {t.identifier}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {t.title || "Linear issue"}
                    </span>
                    <ExternalLink className="size-3.5 shrink-0 text-muted-foreground group-hover:text-sky-400" />
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Linked repos */}
        {repos.length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center gap-2 font-medium text-sm">
              <GitFork className="size-4 text-amber-400" />
              Linked repos
              <Badge className="ml-1" variant="secondary">
                {repos.length}
              </Badge>
            </div>
            <ul className="space-y-1.5">
              {repos.map((r) => (
                <li key={r.fullName}>
                  <a
                    className="group flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 transition-colors hover:border-amber-500/50 hover:bg-accent/40"
                    href={r.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <span className="truncate font-mono text-sm">
                      {r.fullName}
                    </span>
                    <ExternalLink className="size-3.5 shrink-0 text-muted-foreground group-hover:text-amber-400" />
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        <Separator />
        <p className="text-muted-foreground text-xs">
          Links are deterministic explicit references extracted from the doc and
          resolved against the live code graph & Linear.
        </p>
      </div>
    </div>
  );
}

export default function KnowledgePage() {
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DocDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailOpenMobile, setDetailOpenMobile] = useState(false);

  const load = useCallback(() => {
    startTransition(async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/tars/knowledge");
        const data = (await res.json()) as {
          available: boolean;
          docs: DocSummary[];
        };
        setAvailable(data.available);
        setDocs(data.docs);
      } finally {
        setLoading(false);
      }
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selectDoc = useCallback(async (notionId: string) => {
    setSelectedId(notionId);
    setDetailOpenMobile(true);
    setDetailLoading(true);
    try {
      const res = await fetch(
        `/api/tars/knowledge/${encodeURIComponent(notionId)}`
      );
      const data = (await res.json()) as DocDetail;
      setDetail(data);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return docs;
    }
    return docs.filter((d) => d.title.toLowerCase().includes(q));
  }, [docs, query]);

  const totalLinks = useMemo(
    () =>
      docs.reduce(
        (acc, d) => acc + d.fileCount + d.ticketCount + d.repoCount,
        0
      ),
    [docs]
  );

  const SKELETON_KEYS = ["a", "b", "c", "d"];

  function renderDocList() {
    if (loading) {
      return SKELETON_KEYS.map((k) => (
        <div
          className="h-[88px] animate-pulse rounded-lg border border-border bg-card"
          key={`sk-${k}`}
        />
      ));
    }
    if (filtered.length === 0) {
      return (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border border-dashed py-16 text-muted-foreground">
          <BookOpen className="size-8 opacity-40" />
          <p className="font-medium text-sm">
            {docs.length === 0
              ? "No docs ingested yet"
              : "No docs match your search"}
          </p>
          {docs.length === 0 && (
            <p className="max-w-xs text-center text-xs">
              The Notion ingestion runs on the tars-graph schedule. Set{" "}
              <code className="rounded bg-muted px-1">NOTION_API_KEY</code> to
              enable it.
            </p>
          )}
        </div>
      );
    }
    return filtered.map((d) => {
      const isActive = d.notionId === selectedId;
      return (
        <button
          className={cn(
            "block w-full space-y-2.5 rounded-lg border bg-card p-4 text-left transition-all",
            isActive
              ? "border-[#00d4a0]/60 bg-[#00d4a0]/5 ring-1 ring-[#00d4a0]/30"
              : "border-border hover:border-border/80 hover:bg-accent/40"
          )}
          data-testid="knowledge-doc-row"
          key={d.notionId}
          onClick={() => selectDoc(d.notionId)}
          type="button"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 break-words font-medium text-sm leading-snug">
              {d.title}
            </p>
            <span className="shrink-0 whitespace-nowrap text-muted-foreground text-xs">
              {relativeTime(d.ingestedAt)}
            </span>
          </div>
          <LinkCounts doc={d} />
        </button>
      );
    });
  }

  return (
    <div className="min-h-full bg-background">
      <div className="mx-auto max-w-7xl px-4 py-6 md:py-8">
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-[#00d4a0]/10">
                <BookOpen className="size-4 text-[#00d4a0]" />
              </div>
              <h1 className="font-bold text-2xl tracking-tight">Knowledge</h1>
            </div>
            <p className="mt-1.5 text-muted-foreground text-sm">
              Notion docs linked to the code & tickets they describe ·{" "}
              {docs.length} doc{docs.length === 1 ? "" : "s"} · {totalLinks}{" "}
              link{totalLinks === 1 ? "" : "s"}
            </p>
          </div>
          <Button
            className="min-h-[44px]"
            disabled={isPending}
            onClick={load}
            size="sm"
            variant="outline"
          >
            <RefreshCw className={cn("size-4", isPending && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {!(available || loading) && (
          <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-amber-300 text-sm">
            tars-graph is unreachable or the docs index is not built yet.
          </div>
        )}

        {/* Search */}
        <div className="relative mb-4 max-w-md">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search docs…"
            value={query}
          />
        </div>

        {/* Master / detail */}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          {/* List */}
          <div className="space-y-2">{renderDocList()}</div>

          {/* Detail — inline on desktop */}
          <div className="hidden rounded-lg border border-border bg-card lg:block">
            <DocDetailPanel
              detail={detail}
              loading={detailLoading}
              onClose={() => setSelectedId(null)}
            />
          </div>
        </div>
      </div>

      {/* Detail — slide-over on mobile/tablet */}
      <div
        aria-hidden={!detailOpenMobile}
        className={cn(
          "fixed inset-0 z-50 bg-black/50 transition-opacity duration-200 lg:hidden",
          detailOpenMobile ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={() => setDetailOpenMobile(false)}
      />
      <div
        aria-label="Doc detail"
        aria-modal="true"
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-border border-l bg-background shadow-2xl transition-transform duration-200 lg:hidden",
          detailOpenMobile ? "translate-x-0" : "translate-x-full"
        )}
        role="dialog"
      >
        <DocDetailPanel
          detail={detail}
          loading={detailLoading}
          onClose={() => setDetailOpenMobile(false)}
        />
      </div>
    </div>
  );
}
