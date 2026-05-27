"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  attachClickHandler,
  fireNotification,
  getPermissionState,
  type NotificationSettings,
  type NotificationSeverity,
  requestPermission,
} from "@/lib/notifications";

export interface UseNotificationsReturn {
  permission: NotificationPermission;
  settings: NotificationSettings;
  promptPermission: () => Promise<NotificationPermission>;
  updateSettings: (patch: Partial<NotificationSettings>) => void;
  testFire: () => void;
  notify: (
    id: string,
    title: string,
    body: string,
    severity: NotificationSeverity
  ) => void;
}

const STORAGE_KEY = "tars:notification-settings";

function loadSettings(): NotificationSettings {
  if (typeof window === "undefined") {
    return { enabled: false, severity_threshold: "warn" };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<NotificationSettings>;
      return {
        enabled: parsed.enabled ?? false,
        severity_threshold: parsed.severity_threshold ?? "warn",
      };
    }
  } catch {
    // ignore corrupt storage
  }
  return { enabled: false, severity_threshold: "warn" };
}

function saveSettings(s: NotificationSettings): void {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export function useNotifications(): UseNotificationsReturn {
  const router = useRouter();
  const [permission, setPermission] =
    useState<NotificationPermission>("default");
  const [settings, setSettings] = useState<NotificationSettings>(() =>
    loadSettings()
  );

  // Sync permission state on mount
  useEffect(() => {
    setPermission(getPermissionState());
  }, []);

  const promptPermission =
    useCallback(async (): Promise<NotificationPermission> => {
      const result = await requestPermission();
      setPermission(result);
      return result;
    }, []);

  const updateSettings = useCallback((patch: Partial<NotificationSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  // Also persist to app_settings on the server (best-effort, non-blocking)
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  useEffect(() => {
    const t = setTimeout(() => {
      fetch("/api/settings/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settingsRef.current),
      }).catch(() => {
        // best-effort, ignore network errors
      });
    }, 500);
    return () => clearTimeout(t);
  }, [settings]);

  const notify = useCallback(
    (
      id: string,
      title: string,
      body: string,
      severity: NotificationSeverity
    ) => {
      const n = fireNotification({ id, title, body, severity, settings });
      if (n) {
        attachClickHandler(n, id, (path) => router.push(path));
      }
    },
    [settings, router]
  );

  const testFire = useCallback(() => {
    notify(
      "test",
      "TARS — test notification",
      "Notifications are working correctly.",
      "info"
    );
  }, [notify]);

  return {
    permission,
    settings,
    promptPermission,
    updateSettings,
    testFire,
    notify,
  };
}
