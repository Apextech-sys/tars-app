import type { LucideIcon } from "lucide-react";
import { ArrowLeft, Bot, FileText, GitPullRequest } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { JSX } from "react";
import { AuditTimeline } from "@/components/pr-runs/audit-timeline";
import { DisagreementPanel } from "@/components/pr-runs/disagreement-panel";
import { FindingsSummary } from "@/components/pr-runs/findings-summary";
import { RunHeader } from "@/components/pr-runs/run-header";
import type {
  DisagreementPayload,
  PolicyConfig,
  PrRun,
  PrRunDetail,
} from "@/components/pr-runs/types";
import { WebhookEventCard } from "@/components/pr-runs/webhook-event-card";
import { WorkerJobsTable } from "@/components/pr-runs/worker-jobs-table";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function fetchRunDetail(runId: string): Promise<PrRunDetail | null> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";
  try {
    const res = await fetch(
      `${baseUrl}/api/tars/pr-runs/${encodeURIComponent(runId)}`,
      {
        cache: "no-store",
      }
    );
    if (!res.ok) {
      return null;
    }
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
    <div className="mb-4 flex items-center gap-2">
      <Icon className="size-4 text-muted-foreground" />
      <h2 className="font-semibold text-base">{title}</h2>
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
      <div className="mx-auto max-w-5xl space-y-8 px-4 py-6 md:py-8">
        {/* Back link */}
        <div>
          <Link
            className="inline-flex items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
            href="/pr-runs"
          >
            <ArrowLeft className="size-3.5" />
            PR Runs
          </Link>
        </div>

        {/* Run Header */}
        <section>
          <RunHeader prTitle={webhookEvent?.prTitle ?? null} run={run} />
        </section>

        {/* Findings / Status */}
        <section className="rounded-lg border border-border bg-card/30 p-5">
          <SectionHeader icon={FileText} title="Findings" />
          <FindingsSummary auditRows={auditLog} run={run} />
        </section>

        {/* Disagreement panel — only when disagreed */}
        {run.status === "disagreed" &&
          run.disagreedPayload !== null &&
          run.disagreedPayload !== undefined && (
            <section className="rounded-lg border border-purple-500/20 bg-card/30 p-5">
              <SectionHeader
                icon={GitPullRequest}
                title="Reviewer Disagreement"
              />
              <DisagreementPanel
                adjudicationAction={run.adjudicationAction}
                agreementThreshold={agreementThreshold}
                payload={run.disagreedPayload as DisagreementPayload}
                runId={run.runId}
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
