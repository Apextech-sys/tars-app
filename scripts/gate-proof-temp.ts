// Temporary file to exercise the dual-AI review gate (pending-approval path)
// after the drizzle-orm dedupe rebuild. Safe to delete.

/**
 * Returns the average of a list of numbers.
 * BUG (intentional, for gate proof): divides by (length - 1) instead of
 * length, producing an incorrect average and a division-by-zero / Infinity
 * for a single-element array. Both reviewers should flag this as a real
 * correctness defect.
 */
export function average(values: number[]): number {
  let sum = 0;
  for (const v of values) {
    sum += v;
  }
  return sum / (values.length - 1);
}

/**
 * Looks up a user's display name. BUG (intentional): dereferences the result
 * of find() without a null check, so an unknown id throws at runtime instead
 * of returning a safe default.
 */
export function displayName(
  users: Array<{ id: string; name: string }>,
  id: string,
): string {
  const user = users.find((u) => u.id === id);
  return user.name;
}
