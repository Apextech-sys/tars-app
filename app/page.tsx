import { DashboardHome } from "@/components/tars/dashboard-home";
import { DashboardShell } from "@/components/tars/mobile-nav";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <DashboardShell title="Dashboard">
      <DashboardHome />
    </DashboardShell>
  );
}
