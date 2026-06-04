/**
 * Browser-native Notification API helpers.
 * No React dependency — pure logic used by hooks and tests alike.
 */

export type NotificationSeverity = "info" | "warn" | "blocker";

export interface NotificationSettings {
  enabled: boolean;
  severity_threshold: NotificationSeverity;
}

export const SEVERITY_ORDER: Record<NotificationSeverity, number> = {
  info: 0,
  warn: 1,
  blocker: 2,
};

/** Returns true if `severity` meets or exceeds `threshold`. */
export function meetsThreshold(
  severity: NotificationSeverity,
  threshold: NotificationSeverity
): boolean {
  return SEVERITY_ORDER[severity] >= SEVERITY_ORDER[threshold];
}

/** Normalised permission state — treats undefined as "default". */
export function getPermissionState(): NotificationPermission {
  if (typeof Notification === "undefined") {
    return "default";
  }
  return Notification.permission;
}

/** Request permission if not already granted/denied. Returns final state. */
export async function requestPermission(): Promise<NotificationPermission> {
  if (typeof Notification === "undefined") {
    return "denied";
  }
  if (Notification.permission !== "default") {
    return Notification.permission;
  }
  return await Notification.requestPermission();
}

export interface FireNotificationOptions {
  id: string;
  title: string;
  body: string;
  icon?: string;
  severity: NotificationSeverity;
  settings: NotificationSettings;
}

/**
 * Fire a browser notification if permission is granted and the settings
 * allow it. Uses `tag` to replace duplicate escalation notifications.
 * Returns the Notification instance or null if not shown.
 */
export function fireNotification(
  opts: FireNotificationOptions
): Notification | null {
  if (typeof Notification === "undefined") {
    return null;
  }
  if (Notification.permission !== "granted") {
    return null;
  }
  if (!opts.settings.enabled) {
    return null;
  }
  if (
    !meetsThreshold(opts.severity, opts.settings.severity_threshold ?? "info")
  ) {
    return null;
  }

  const n = new Notification(opts.title, {
    body: opts.body,
    icon: opts.icon ?? "/favicon.ico",
    tag: `escalation-${opts.id}`,
  });

  return n;
}

/** Navigate + focus the tab when a notification is clicked. */
export function attachClickHandler(
  notification: Notification,
  id: string | undefined,
  navigate: (path: string) => void
): void {
  notification.onclick = () => {
    window.focus();
    navigate(id ? `/inbox/${id}` : "/inbox");
  };
}
