import type { ReactNode } from "react";
import { DashboardShell } from "@/components/tars/mobile-nav";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return <DashboardShell title="Settings">{children}</DashboardShell>;
}
