import type { ReactNode } from "react";
import { DashboardShell } from "@/components/tars/mobile-nav";

export default function BriefsLayout({ children }: { children: ReactNode }) {
  return <DashboardShell title="Briefs">{children}</DashboardShell>;
}
