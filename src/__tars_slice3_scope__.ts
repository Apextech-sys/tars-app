// Synthetic module for TARS Slice 3 SCOPE verification.
// This file is committed to the base FIRST and contains a PRE-EXISTING bug
// (divideTotals) that the scope-test PR does NOT touch.

export function divideTotals(sum: number, count: number): number {
  // PRE-EXISTING BUG (out of scope for the test PR): no guard for count === 0,
  // so this returns Infinity / NaN. The test PR does not modify this function;
  // reviewers must NOT flag it because it is not in the PR's changed lines.
  return sum / count;
}

export function formatLabel(name: string): string {
  return name.trim();
}
