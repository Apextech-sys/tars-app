// Synthetic throwaway module for TARS Slice 3 debate verification (divergence).

export interface RetryOpts {
  attempts: number;
  baseMs: number;
}

/**
 * Compute the backoff delay for a given retry attempt (0-indexed).
 */
export function backoffDelay(attempt: number, opts: RetryOpts): number {
  // Ambiguous: uses Math.pow with attempt directly. On attempt=0 this is
  // baseMs * 1 = baseMs. Some reviewers may flag that there is no jitter and
  // no max-cap (unbounded growth); others consider that out-of-scope for a
  // helper this small. Genuinely debatable.
  return opts.baseMs * 2 ** attempt;
}

/**
 * Parse a user-supplied count, defaulting to 3.
 */
export function parseCount(raw: string | undefined): number {
  // Subtle: Number("") === 0, and Number("  ") === 0, so an empty/whitespace
  // string yields 0 rather than the intended default of 3. Number(undefined)
  // is NaN which the ?? does NOT catch (NaN is not nullish). Debatable whether
  // this is a real defect or acceptable.
  const n = Number(raw);
  return n || 3;
}
