import { ExternalLink, Workflow } from "lucide-react";
import { TemporalWorkflowsView } from "@/components/tars/temporal-workflows-view";
import { getTemporal, namespaceUrl } from "@/lib/tars/graph-temporal";

export const dynamic = "force-dynamic";

export default async function TemporalPage() {
  const t = await getTemporal();

  if (!t.available) {
    return (
      <div className="p-6 text-muted-foreground text-sm">
        Temporal view unavailable. {t.notes ?? ""}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-semibold text-xl">
            <Workflow className="size-5 text-[#00d4a0]" /> Temporal Workflows
          </h1>
          <p className="text-muted-foreground text-sm">
            Reflex Connect order orchestration · namespace{" "}
            <span className="font-mono text-xs">{t.namespace}</span> · read-only
          </p>
        </div>
        <a
          className="inline-flex items-center gap-1 rounded-full border border-[#00d4a0]/30 bg-[#00d4a0]/10 px-3 py-1 text-[#00d4a0] text-sm hover:underline"
          href={namespaceUrl(t.namespace)}
          rel="noreferrer"
          target="_blank"
        >
          Open in Temporal Cloud <ExternalLink className="size-3.5" />
        </a>
      </div>

      <TemporalWorkflowsView
        counts={t.counts}
        namespace={t.namespace}
        workflows={t.workflows}
      />
    </div>
  );
}
