/**
 * Timing-safe comparator for the TARS_INTERNAL_SECRET shared secret.
 *
 * Used by every internal HTTP route that gates on a body.authToken to keep
 * the auth check from leaking byte-by-byte timing information to an
 * attacker. Hashing both sides first sidesteps the `timingSafeEqual`
 * length-mismatch constraint: SHA-256 produces a fixed-width 32-byte
 * digest regardless of input length, so the comparison itself is always
 * over equal-length buffers.
 *
 * Returns false for any falsy `provided` value (missing / empty string)
 * without invoking the comparator — there's nothing to compare and we
 * don't want to feed undefined into createHash.
 */

import { createHash, timingSafeEqual } from "node:crypto";

export function timingSafeAuthTokenEqual(
  provided: string | undefined | null,
  expected: string
): boolean {
  if (!provided) {
    return false;
  }
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
