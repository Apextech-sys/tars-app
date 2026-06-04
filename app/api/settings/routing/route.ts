import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAppSetting, setAppSetting } from "@/lib/tars/app-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RoutingPayload {
  slackAllowedChannels: string[];
  slackBotUserId: string | null;
  linearBotUserId: string | null;
}

const bodySchema = z.object({
  slackAllowedChannels: z.array(z.string().max(120)).max(50).optional(),
  slackBotUserId: z.string().max(120).nullable().optional(),
  linearBotUserId: z.string().max(120).nullable().optional(),
});

/**
 * Reads/writes the notification-routing keys (where escalations are posted).
 * These app_settings keys are schema-defined but unset on a fresh install, so
 * the FE renders honest "not configured" empty states until edited.
 */
export async function GET(): Promise<NextResponse> {
  const slackAllowedChannels =
    (await getAppSetting<string[]>("slack_allowed_channels")) ?? [];
  const slackBotUserId =
    (await getAppSetting<string>("slack_bot_user_id")) ?? null;
  const linearBotUserId =
    (await getAppSetting<string>("linear_bot_user_id")) ?? null;

  const payload: RoutingPayload = {
    slackAllowedChannels,
    slackBotUserId,
    linearBotUserId,
  };
  return NextResponse.json(payload);
}

export async function PATCH(request: Request): Promise<NextResponse> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 }
    );
  }

  if (parsed.data.slackAllowedChannels !== undefined) {
    const cleaned = parsed.data.slackAllowedChannels
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    await setAppSetting("slack_allowed_channels", cleaned);
  }
  if (parsed.data.slackBotUserId !== undefined) {
    await setAppSetting("slack_bot_user_id", parsed.data.slackBotUserId);
  }
  if (parsed.data.linearBotUserId !== undefined) {
    await setAppSetting("linear_bot_user_id", parsed.data.linearBotUserId);
  }

  try {
    revalidatePath("/settings");
  } catch {
    /* no-op outside request context */
  }

  return NextResponse.json({ ok: true });
}
