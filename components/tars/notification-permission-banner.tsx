"use client";

import { Bell, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { getPermissionState } from "@/lib/notifications";

interface Props {
  onRequest: () => Promise<NotificationPermission>;
}

const DISMISSED_KEY = "tars:notif-banner-dismissed";

export function NotificationPermissionBanner({ onRequest }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const permission = getPermissionState();
    const dismissed =
      typeof window === "undefined"
        ? true
        : sessionStorage.getItem(DISMISSED_KEY) === "1";
    if (permission === "default" && !dismissed) {
      setVisible(true);
    }
  }, []);

  const dismiss = () => {
    sessionStorage.setItem(DISMISSED_KEY, "1");
    setVisible(false);
  };

  const enable = async () => {
    await onRequest();
    dismiss();
  };

  if (!visible) {
    return null;
  }

  return (
    <div
      aria-label="Enable desktop notifications"
      className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm"
      role="banner"
    >
      <Bell className="size-4 shrink-0 text-primary" />
      <p className="flex-1 text-foreground">
        Enable desktop notifications to get alerted about escalations.
      </p>
      <Button
        className="min-h-[44px] px-4"
        onClick={enable}
        size="sm"
        variant="default"
      >
        Enable
      </Button>
      <Button
        aria-label="Dismiss"
        className="min-h-[44px] min-w-[44px] p-0"
        onClick={dismiss}
        size="sm"
        variant="ghost"
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}
