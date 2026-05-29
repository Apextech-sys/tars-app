/**
 * Constrain a number to the inclusive range [min, max].
 *
 * NOTE (E2E fixture): this intentionally contains a real bug for the TARS
 * fix-stage end-to-end proof — see clamp.test.ts. Safe to delete.
 */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    // BUG: should return `max`, but returns `min`, so values above the
    // upper bound are wrongly snapped to the bottom of the range.
    return min;
  }
  return value;
}
