import type { ReactNode } from "react";
import { DashboardShell } from "@/components/tars/mobile-nav";

export default function AuditLayout({ children }: { children: ReactNode }) {
  return <DashboardShell title="Audit Log">{children}</DashboardShell>;
}
