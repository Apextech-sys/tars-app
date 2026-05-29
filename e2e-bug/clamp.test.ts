import { describe, expect, it } from "vitest";
import { clamp } from "./clamp.js";

// E2E fixture for the TARS fix-stage proof. These cases pass against the buggy
// implementation because none of them exercises the value > max path — that is
// the coverage gap the fix agent should close with a new regression test.
describe("clamp", () => {
  it("returns the value when inside the range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("clamps to the lower bound when below min", () => {
    expect(clamp(-3, 0, 10)).toBe(0);
  });
});
