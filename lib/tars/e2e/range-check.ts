/**
 * Throwaway E2E fixture for the TARS baseline-diff test gate.
 *
 * BUG (intentional, for the reviewer to catch): the upper bound uses `<`
 * instead of `<=`, so an inclusive range check wrongly excludes the max value —
 * e.g. inRange(5, 1, 5) returns false when it should return true.
 */
export function inRange(value: number, min: number, max: number): boolean {
  return value >= min && value < max;
}
