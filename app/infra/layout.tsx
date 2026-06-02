import type { ReactNode } from "react";
import { DashboardShell } from "@/components/tars/mobile-nav";

export default function InfraLayout({ children }: { children: ReactNode }) {
  return <DashboardShell title="Infrastructure">{children}</DashboardShell>;
}
