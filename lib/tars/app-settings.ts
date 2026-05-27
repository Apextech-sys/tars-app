/**
 * Typed key/value accessor over the app_settings table.
 * Values are stored as jsonb.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/tars-schema";

export type AppSettingKey =
  | "slack_allowed_channels"
  | "slack_bot_user_id"
  | "linear_bot_user_id";

export async function getAppSetting<T = unknown>(
  key: AppSettingKey,
): Promise<T | null> {
  const row = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, key),
  });
  return (row?.value as T) ?? null;
}

export async function setAppSetting<T>(
  key: AppSettingKey,
  value: T,
): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value: value as never })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: value as never, updatedAt: new Date() },
    });
}
