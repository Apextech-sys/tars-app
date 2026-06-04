import { Webhook } from "lucide-react";
import { getIngressRepos, getWebhookStats } from "@/lib/tars/webhooks-stats";
import { WebhookConsole } from "./webhook-console";

export const dynamic = "force-dynamic";

export default async function WebhooksPage() {
  const [stats, ingress] = await Promise.all([
    getWebhookStats(24),
    getIngressRepos(),
  ]);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      <header>
        <h1 className="flex items-center gap-2 font-semibold text-xl">
          <Webhook className="size-5 text-[#00d4a0]" /> Webhooks
        </h1>
        <p className="max-w-3xl text-muted-foreground text-sm">
          A live ops console for every inbound GitHub webhook TARS receives: how
          much is flowing in, which configured repos are firing, and what
          fraction of pull-request events actually triggered a review run. Drill
          from any metric into the filtered event stream and inspect a single
          delivery&apos;s payload and the run it triggered — all in here.
        </p>
      </header>

      <WebhookConsole ingress={ingress} stats={stats} />
    </div>
  );
}
