// Test helper added by PR review verification.
// Intentionally contains a few code-quality issues to exercise the reviewers.

export function unsafeParseInt(s: string): number {
  // Bug: no radix specified
  return parseInt(s);
}

export async function fetchAndProcess(url: string): Promise<unknown> {
  // Bug: no try/catch, swallows errors silently in many callers
  // Bug: no timeout, no signal
  const res = await fetch(url);
  // Bug: no status check before .json()
  const data: any = await res.json();
  // Bug: SQL-like string concatenation (just an example pattern)
  const query = "SELECT * FROM items WHERE id = '" + data.id + "'";
  console.log(query);
  return data;
}

// Bug: unused export
export const UNUSED_CONST = 42;
