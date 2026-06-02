import type { ReactNode } from "react";
import { DashboardShell } from "@/components/tars/mobile-nav";

export default function KnowledgeLayout({ children }: { children: ReactNode }) {
  return <DashboardShell title="Knowledge">{children}</DashboardShell>;
}
