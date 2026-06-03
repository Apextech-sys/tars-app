import type { ReactNode } from "react";
import { DashboardShell } from "@/components/tars/mobile-nav";

export default function TemporalLayout({ children }: { children: ReactNode }) {
  return <DashboardShell title="Temporal">{children}</DashboardShell>;
}
