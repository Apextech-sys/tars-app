/**
 * Resolves the chat + code-review model from the Settings page (app_settings),
 * with the latest Claude as the default. Previously these were hardcoded
 * (claude-sonnet-4-6) and the Settings picker was cosmetic — this makes the
 * picker actually control the runtime. Defaults to Opus 4.8 (claude-opus-4-8),
 * Anthropic's most capable model (1M context, May 2026).
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/tars-schema";

export const DEFAULT_CHAT_MODEL = "claude-opus-4-8";
export const DEFAULT_CODE_REVIEW_MODEL = "claude-opus-4-8";

async function readModel(key: string, fallback: string): Promise<string> {
  try {
    const rows = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, key))
      .limit(1);
    const v = rows[0]?.value;
    return typeof v === "string" && v.length > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

export function getChatModel(): Promise<string> {
  return readModel("chat_model", DEFAULT_CHAT_MODEL);
}

export function getCodeReviewModel(): Promise<string> {
  return readModel("code_review_model", DEFAULT_CODE_REVIEW_MODEL);
}
