// gate-final: intentional off-by-one and unsafe array access for review
export function getLatestEvent(events: Array<{ ts: number; type: string }>): string {
  // BUG: no empty-array guard, will throw on empty input
  const latest = events.sort((a, b) => b.ts - a.ts)[0];
  return latest.type;
}

export function sumPositive(nums: number[]): number {
  // BUG: filter condition is wrong — filters positive, should keep positive
  return nums.filter(n => n < 0).reduce((acc, n) => acc + n, 0);
}
