import type { ReactNode } from "react";
import { DashboardShell } from "@/components/tars/mobile-nav";

/**
 * Layout for the /workflows control room (overview + per-workflow run history +
 * single-run timeline). Wraps the dashboard shell like every other TARS page.
 *
 * The legacy @xyflow visual-builder canvas that previously lived here has moved
 * to /workflows-canvas (it is a separate, full-screen React Flow surface backed
 * by the user-workflow World — empty in prod — and must not be confused with
 * TARS's own durable WDK workflows shown here).
 */
export default function WorkflowsLayout({ children }: { children: ReactNode }) {
  return <DashboardShell title="Workflows">{children}</DashboardShell>;
}
