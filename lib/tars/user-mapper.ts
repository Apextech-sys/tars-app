/**
 * Map an external chat-platform user (Slack, Linear) to a tars user id.
 *
 * Strategy:
 *  1. Look up by slack_user_id / linear_user_id on users table.
 *  2. If not found, create an anonymous user with a deterministic id
 *     (`slack:<id>` or `linear:<id>`) and stamp the platform user id.
 *  3. Return the tars user id.
 */
import { eq } from "drizzle-orm";
import { db, migrationClient } from "@/lib/db";
import { users } from "@/lib/db/schema";

export async function mapSlackUserToTars(slackUserId: string): Promise<string> {
  const existing = await db.query.users.findFirst({
    where: eq(users.slackUserId, slackUserId),
  });
  if (existing) return existing.id;

  const tarsUserId = `slack:${slackUserId}`;
  await migrationClient`
    INSERT INTO users (id, name, email, email_verified, is_anonymous, created_at, updated_at, slack_user_id)
    VALUES (${tarsUserId}, ${"Slack " + slackUserId}, NULL, false, true, now(), now(), ${slackUserId})
    ON CONFLICT (id) DO UPDATE SET slack_user_id = EXCLUDED.slack_user_id
  `;
  return tarsUserId;
}

export async function mapLinearUserToTars(
  linearUserId: string,
  displayName?: string,
): Promise<string> {
  const existing = await db.query.users.findFirst({
    where: eq(users.linearUserId, linearUserId),
  });
  if (existing) return existing.id;

  const tarsUserId = `linear:${linearUserId}`;
  await migrationClient`
    INSERT INTO users (id, name, email, email_verified, is_anonymous, created_at, updated_at, linear_user_id)
    VALUES (
      ${tarsUserId},
      ${displayName ?? "Linear " + linearUserId},
      NULL,
      false,
      true,
      now(),
      now(),
      ${linearUserId}
    )
    ON CONFLICT (id) DO UPDATE SET linear_user_id = EXCLUDED.linear_user_id
  `;
  return tarsUserId;
}
