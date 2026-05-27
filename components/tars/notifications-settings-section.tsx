"use client";

import { Bell, BellOff, TestTube2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useNotifications } from "@/hooks/use-notifications";
import type { NotificationSeverity } from "@/lib/notifications";

const SEVERITY_OPTIONS: { value: NotificationSeverity; label: string }[] = [
  { value: "info", label: "All (info and above)" },
  { value: "warn", label: "Warnings and blockers" },
  { value: "blocker", label: "Blockers only" },
];

export function NotificationsSettingsSection() {
  const { permission, settings, promptPermission, updateSettings, testFire } =
    useNotifications();

  // If user toggled enabled but permission is still default, request it
  const toggleEnabled = async () => {
    const newEnabled = !settings.enabled;
    if (newEnabled) {
      if (permission === "default") {
        const p = await promptPermission();
        if (p === "denied") {
          toast.error(
            "Permission denied — enable notifications in browser settings."
          );
          return;
        }
      } else if (permission === "denied") {
        toast.error(
          "Permission denied — enable notifications in browser site settings."
        );
        return;
      }
    }
    updateSettings({ enabled: newEnabled });
  };

  const handleTestFire = () => {
    if (permission !== "granted") {
      toast.error("Grant notification permission first.");
      return;
    }
    testFire();
    toast.success("Test notification sent");
  };

  return (
    <section
      className="rounded-lg border bg-card"
      data-testid="notifications-section"
    >
      <div className="border-b p-5">
        <h2 className="font-semibold text-base">Notifications</h2>
        <p className="mt-0.5 text-muted-foreground text-sm">
          Browser-native push alerts for escalations and inbox events.
        </p>
      </div>
      <div className="space-y-5 p-5">
        {/* Permission status */}
        {permission === "denied" && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm">
            <BellOff className="size-4 shrink-0" />
            <span>
              Notification permission was denied. Re-enable in browser site
              settings, then reload.
            </span>
          </div>
        )}

        {/* Enable toggle */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-medium text-sm">Enable notifications</p>
            <p className="mt-0.5 text-muted-foreground text-xs">
              Shows a desktop alert when escalations arrive in the inbox.
            </p>
          </div>
          <button
            aria-checked={settings.enabled}
            aria-label="Toggle notifications"
            className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-input transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 aria-checked:bg-primary"
            data-testid="notifications-toggle"
            disabled={false}
            onClick={toggleEnabled}
            role="switch"
            type="button"
          >
            <span className="pointer-events-none block h-5 w-5 translate-x-0 rounded-full bg-background shadow-lg ring-0 transition-transform aria-checked:translate-x-5 aria-[checked=true]:translate-x-5 data-[state=checked]:translate-x-5" />
          </button>
        </div>

        {/* Severity threshold */}
        <div className="space-y-1.5">
          <label className="font-medium text-sm" htmlFor="severity-threshold">
            Minimum severity
          </label>
          <select
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            id="severity-threshold"
            onChange={(e) =>
              updateSettings({
                severity_threshold: e.target.value as NotificationSeverity,
              })
            }
            value={settings.severity_threshold}
          >
            {SEVERITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {/* Test fire */}
        <div className="flex items-center gap-3 pt-1">
          <Button
            className="min-h-[44px]"
            data-testid="notifications-test-btn"
            disabled={!settings.enabled || permission !== "granted"}
            onClick={handleTestFire}
            size="sm"
            variant="outline"
          >
            <TestTube2 className="size-3.5" />
            Send test notification
          </Button>
          {settings.enabled && permission === "granted" && (
            <span className="flex items-center gap-1.5 text-emerald-600 text-xs dark:text-emerald-400">
              <Bell className="size-3.5" />
              Active
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
