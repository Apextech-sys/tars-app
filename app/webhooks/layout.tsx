import type { ReactNode } from "react";
import { DashboardShell } from "@/components/tars/mobile-nav";

export default function WebhooksLayout({ children }: { children: ReactNode }) {
  return <DashboardShell title="Webhooks">{children}</DashboardShell>;
}
