/**
 * app/inbox/__tests__/escalations.test.ts
 *
 * Tests for Server Actions: resolveEscalation, snoozeEscalation, deferEscalation.
 * Uses the real Postgres DB (DATABASE_URL must be set).
 */

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

// Mock next/cache before any action imports
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import {
  createEscalation,
  deferEscalation,
  fetchInboxItems,
  resolveEscalation,
  snoozeEscalation,
} from "@/app/inbox/actions";
import { db } from "@/lib/db";
import { escalations } from "@/lib/db/tars-schema";

// Track IDs created during test so we can clean up
const createdIds: string[] = [];

async function insertTestEscalation(
  overrides: Partial<{
    title: string;
    severity: "info" | "warn" | "blocker";
    source: string;
  }> = {}
): Promise<string> {
  const [row] = await db
    .insert(escalations)
    .values({
      source: overrides.source ?? "test",
      severity: overrides.severity ?? "info",
      title: overrides.title ?? "Test escalation",
      status: "open",
    })
    .returning({ id: escalations.id });
  createdIds.push(row.id);
  return row.id;
}

afterAll(async () => {
  for (const id of createdIds) {
    await db.delete(escalations).where(eq(escalations.id, id));
  }
});

describe("resolveEscalation", () => {
  it("sets status=resolved and stores resolution note", async () => {
    const id = await insertTestEscalation({ title: "Resolve me" });
    await resolveEscalation(id, "Fixed via test");

    const [row] = await db
      .select()
      .from(escalations)
      .where(eq(escalations.id, id));

    expect(row.status).toBe("resolved");
    expect(row.resolutionNote).toBe("Fixed via test");
    expect(row.resolvedAt).not.toBeNull();
    expect(row.resolvedBy).toBe("shaun");
  });

  it("works with empty note", async () => {
    const id = await insertTestEscalation({ title: "Resolve empty note" });
    await resolveEscalation(id, "");

    const [row] = await db
      .select()
      .from(escalations)
      .where(eq(escalations.id, id));

    expect(row.status).toBe("resolved");
    expect(row.resolutionNote).toBe("");
  });
});

describe("snoozeEscalation", () => {
  it("sets status=snoozed with future snoozed_until", async () => {
    const id = await insertTestEscalation({ title: "Snooze me" });
    const before = new Date();
    await snoozeEscalation(id, 1);

    const [row] = await db
      .select()
      .from(escalations)
      .where(eq(escalations.id, id));

    expect(row.status).toBe("snoozed");
    expect(row.snoozedUntil).not.toBeNull();
    const snoozedUntil = row.snoozedUntil;
    if (snoozedUntil == null) {
      throw new Error("snoozedUntil should be set after snoozing");
    }
    const delta = snoozedUntil.getTime() - before.getTime();
    expect(delta).toBeGreaterThan(3_590_000);
    expect(delta).toBeLessThan(3_610_000);
  });

  it("can snooze for 24h", async () => {
    const id = await insertTestEscalation({ title: "Snooze 24h" });
    await snoozeEscalation(id, 24);

    const [row] = await db
      .select()
      .from(escalations)
      .where(eq(escalations.id, id));

    const snoozedUntil = row.snoozedUntil;
    if (snoozedUntil == null) {
      throw new Error("snoozedUntil should be set after snoozing");
    }
    const delta = snoozedUntil.getTime() - Date.now();
    expect(delta).toBeGreaterThan(23 * 3_600_000);
  });
});

describe("deferEscalation", () => {
  it("sets status=deferred", async () => {
    const id = await insertTestEscalation({ title: "Defer me" });
    await deferEscalation(id);

    const [row] = await db
      .select()
      .from(escalations)
      .where(eq(escalations.id, id));

    expect(row.status).toBe("deferred");
  });
});

describe("createEscalation + fetchInboxItems", () => {
  it("creates an escalation that appears in inbox", async () => {
    const title = `Test inbox item ${Date.now()}`;
    await createEscalation({
      source: "test-suite",
      severity: "warn",
      title,
    });

    const [created] = await db
      .select()
      .from(escalations)
      .where(eq(escalations.title, title));
    createdIds.push(created.id);

    const items = await fetchInboxItems();
    const found = items.find(
      (i) => i.kind === "escalation" && i.title === title
    );
    expect(found).toBeDefined();
    expect(found?.kind).toBe("escalation");
  });
});
