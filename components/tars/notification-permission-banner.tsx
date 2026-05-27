"use client";

import { Bell, BellOff, X } from "lucide-react";
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
      typeof window !== "undefined"
        ? sessionStorage.getItem(DISMISSED_KEY) === "1"
        : true;
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

  if (!visible) return null;

  return (
    <div
      role="banner"
      aria-label="Enable desktop notifications"
      className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm"
    >
      <Bell className="size-4 shrink-0 text-primary" />
      <p className="flex-1 text-foreground">
        Enable desktop notifications to get alerted about escalations.
      </p>
      <Button
        size="sm"
        variant="default"
        className="min-h-[44px] px-4"
        onClick={enable}
      >
        Enable
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="min-h-[44px] min-w-[44px] p-0"
        aria-label="Dismiss"
        onClick={dismiss}
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}
