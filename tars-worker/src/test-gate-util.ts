// test utility — intentional bug for dual-AI gate verification (v2)
// BUG: divide() has no zero-denominator guard; calling divide(x, 0) returns Infinity or throws
export function divide(a: number, b: number): number {
  return a / b; // missing: if (b === 0) throw new Error("division by zero")
}

// BUG: parseUserInput does not sanitise or validate — passes raw user string directly to eval
export function parseUserInput(input: string): unknown {
  // eslint-disable-next-line no-eval
  return eval(input); // arbitrary code execution vulnerability
}
