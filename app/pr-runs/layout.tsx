import type { ReactNode } from "react";
import { DashboardShell } from "@/components/tars/mobile-nav";

export default function PrRunsLayout({ children }: { children: ReactNode }) {
  return <DashboardShell title="PR Runs">{children}</DashboardShell>;
}
