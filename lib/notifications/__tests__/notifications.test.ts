import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  meetsThreshold,
  getPermissionState,
  fireNotification,
  type NotificationSettings,
} from "../index";

// ── meetsThreshold ────────────────────────────────────────────────────────────

describe("meetsThreshold", () => {
  it("info meets info threshold", () => {
    expect(meetsThreshold("info", "info")).toBe(true);
  });
  it("warn meets info threshold", () => {
    expect(meetsThreshold("warn", "info")).toBe(true);
  });
  it("blocker meets warn threshold", () => {
    expect(meetsThreshold("blocker", "warn")).toBe(true);
  });
  it("info does NOT meet warn threshold", () => {
    expect(meetsThreshold("info", "warn")).toBe(false);
  });
  it("info does NOT meet blocker threshold", () => {
    expect(meetsThreshold("info", "blocker")).toBe(false);
  });
  it("warn does NOT meet blocker threshold", () => {
    expect(meetsThreshold("warn", "blocker")).toBe(false);
  });
  it("blocker meets blocker threshold", () => {
    expect(meetsThreshold("blocker", "blocker")).toBe(true);
  });
});

// ── getPermissionState ────────────────────────────────────────────────────────

describe("getPermissionState", () => {
  it("returns default when Notification is undefined", () => {
    // Notification is not available in jsdom/node by default
    const original = (global as Record<string, unknown>).Notification;
    // biome-ignore lint/performance/noDelete: test teardown
    delete (global as Record<string, unknown>).Notification;
    expect(getPermissionState()).toBe("default");
    if (original !== undefined) {
      (global as Record<string, unknown>).Notification = original;
    }
  });

  it("returns granted when Notification.permission is granted", () => {
    (global as Record<string, unknown>).Notification = {
      permission: "granted",
    };
    expect(getPermissionState()).toBe("granted");
    // biome-ignore lint/performance/noDelete: test teardown
    delete (global as Record<string, unknown>).Notification;
  });
});

// ── fireNotification ──────────────────────────────────────────────────────────

describe("fireNotification", () => {
  const enabledSettings: NotificationSettings = {
    enabled: true,
    severity_threshold: "info",
  };

  beforeEach(() => {
    // Mock global Notification with permission: granted
    const mockNotification = vi.fn(function (
      this: Record<string, unknown>,
      title: string,
      opts: NotificationOptions,
    ) {
      this.title = title;
      this.body = (opts as Record<string, unknown>).body;
      this.tag = (opts as Record<string, unknown>).tag;
      this.onclick = null;
    }) as unknown as typeof Notification;
    (mockNotification as unknown as Record<string, unknown>).permission =
      "granted";
    (mockNotification as unknown as Record<string, unknown>).requestPermission =
      vi.fn().mockResolvedValue("granted");
    (global as Record<string, unknown>).Notification = mockNotification;
  });

  afterEach(() => {
    // biome-ignore lint/performance/noDelete: test teardown
    delete (global as Record<string, unknown>).Notification;
  });

  it("fires when permission granted + settings enabled", () => {
    const result = fireNotification({
      id: "abc-123",
      title: "Test",
      body: "Body",
      severity: "warn",
      settings: enabledSettings,
    });
    expect(result).not.toBeNull();
  });

  it("does NOT fire when settings disabled", () => {
    const result = fireNotification({
      id: "abc-123",
      title: "Test",
      body: "Body",
      severity: "warn",
      settings: { enabled: false, severity_threshold: "info" },
    });
    expect(result).toBeNull();
  });

  it("does NOT fire when severity below threshold", () => {
    const result = fireNotification({
      id: "abc-123",
      title: "Test",
      body: "Body",
      severity: "info",
      settings: { enabled: true, severity_threshold: "blocker" },
    });
    expect(result).toBeNull();
  });

  it("does NOT fire when permission is denied", () => {
    (
      (global as Record<string, unknown>).Notification as unknown as Record<
        string,
        unknown
      >
    ).permission = "denied";
    const result = fireNotification({
      id: "abc-123",
      title: "Test",
      body: "Body",
      severity: "blocker",
      settings: enabledSettings,
    });
    expect(result).toBeNull();
  });

  it("uses escalation-<id> tag to deduplicate", () => {
    const result = fireNotification({
      id: "abc-123",
      title: "Test",
      body: "Body",
      severity: "info",
      settings: enabledSettings,
    }) as unknown as Record<string, unknown> | null;
    expect(result?.tag).toBe("escalation-abc-123");
  });

  it("fires blocker even with blocker threshold", () => {
    const result = fireNotification({
      id: "xyz",
      title: "Critical",
      body: "Blocker!",
      severity: "blocker",
      settings: { enabled: true, severity_threshold: "blocker" },
    });
    expect(result).not.toBeNull();
  });
});
