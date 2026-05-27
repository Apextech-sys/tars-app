import { DashboardShell } from "@/components/tars/mobile-nav";
import { DashboardHome } from "@/components/tars/dashboard-home";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <DashboardShell title="Dashboard">
      <DashboardHome />
    </DashboardShell>
  );
}
