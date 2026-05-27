import type { LucideIcon } from "lucide-react";
import type { JSX } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Bot, FileText, GitPullRequest, Webhook } from "lucide-react";
import { RunHeader } from "@/components/pr-runs/run-header";
import { FindingsSummary } from "@/components/pr-runs/findings-summary";
import { DisagreementPanel } from "@/components/pr-runs/disagreement-panel";
import { AuditTimeline } from "@/components/pr-runs/audit-timeline";
import { WorkerJobsTable } from "@/components/pr-runs/worker-jobs-table";
import { WebhookEventCard } from "@/components/pr-runs/webhook-event-card";
import type { DisagreementPayload, PolicyConfig, PrRun, PrRunDetail } from "@/components/pr-runs/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function fetchRunDetail(runId: string): Promise<PrRunDetail | null> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";
  try {
    const res = await fetch(`${baseUrl}/api/tars/pr-runs/${encodeURIComponent(runId)}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json() as Promise<PrRunDetail>;
  } catch {
    return null;
  }
}

function SectionHeader({
  icon: Icon,
  title,
}: {
  icon: LucideIcon;
  title: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <Icon className="size-4 text-muted-foreground" />
      <h2 className="text-base font-semibold">{title}</h2>
    </div>
  );
}

export default async function PrRunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}): Promise<JSX.Element> {
  const { runId } = await params;
  const detail = await fetchRunDetail(runId);

  if (!detail) {
    notFound();
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const detailData = detail!;
  const run = detailData.run as PrRun;
  const auditLog = detailData.auditLog;
  const webhookEvent = detailData.webhookEvent;
  const jobs = detailData.jobs;
  const policy = run.policy as PolicyConfig | null;
  const agreementThreshold =
    typeof policy?.agreementThreshold === "number"
      ? policy.agreementThreshold
      : 0.7;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-6 md:py-8 space-y-8">
        {/* Back link */}
        <div>
          <Link
            href="/pr-runs"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="size-3.5" />
            PR Runs
          </Link>
        </div>

        {/* Run Header */}
        <section>
          <RunHeader
            run={run}
            prTitle={webhookEvent?.prTitle ?? null}
          />
        </section>

        {/* Findings / Status */}
        <section className="rounded-lg border border-border bg-card/30 p-5">
          <SectionHeader icon={FileText} title="Findings" />
          <FindingsSummary run={run} auditRows={auditLog} />
        </section>

        {/* Disagreement panel — only when disagreed */}
        {run.status === "disagreed" && run.disagreedPayload !== null && run.disagreedPayload !== undefined && (
          <section className="rounded-lg border border-purple-500/20 bg-card/30 p-5">
            <SectionHeader icon={GitPullRequest} title="Reviewer Disagreement" />
            <DisagreementPanel
              runId={run.runId}
              payload={run.disagreedPayload as DisagreementPayload}
              adjudicationAction={run.adjudicationAction}
              agreementThreshold={agreementThreshold}
            />
          </section>
        )}

        {/* Audit Timeline */}
        <section className="rounded-lg border border-border bg-card/30 p-5">
          <SectionHeader icon={FileText} title="Audit Timeline" />
          <AuditTimeline rows={auditLog} />
        </section>

        {/* Worker Jobs */}
        <section className="rounded-lg border border-border bg-card/30 p-5">
          <SectionHeader icon={Bot} title="Worker Jobs" />
          <WorkerJobsTable jobs={jobs} />
        </section>

        {/* Webhook Event */}
        {webhookEvent && (
          <section>
            <WebhookEventCard event={webhookEvent} />
          </section>
        )}
      </div>
    </div>
  );
}
