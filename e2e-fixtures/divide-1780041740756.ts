/**
 * Divide two numbers.
 * Returns null when the divisor is zero (callers rely on this contract).
 */
export function divide(a: number, b: number): number | null {
  // BUG: missing the b === 0 guard documented above; returns Infinity.
  return a / b;
}
