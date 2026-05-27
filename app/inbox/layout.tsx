import type { ReactNode } from "react";
import { DashboardShell } from "@/components/tars/mobile-nav";

export default function InboxLayout({ children }: { children: ReactNode }) {
  return <DashboardShell title="Inbox">{children}</DashboardShell>;
}
