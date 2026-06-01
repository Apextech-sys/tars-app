// gate-0 test: intentionally missing null check (will be caught by TARS review)
export function parseWebhookTimestamp(ts: string | undefined): Date {
  // BUG: no null check — ts could be undefined, causing new Date(undefined) = Invalid Date
  return new Date(ts);
}

export function formatTimestamp(ts: string | undefined): string {
  // BUG: calling .toISOString() on potentially Invalid Date
  const d = parseWebhookTimestamp(ts);
  return d.toISOString();
}
