import { describe, expect, it } from "vitest";
import { pageBounds } from "../paginate";

// NOTE: this existing test only checks `totalPages` and the `start` index — it
// never asserts on `end` or the actual page contents, which is exactly why the
// off-by-one in `end` slipped through. (Throwaway fixture for Slice 2 E2E.)
describe("pageBounds", () => {
  it("computes totalPages correctly", () => {
    expect(pageBounds(10, 1, 4).totalPages).toBe(3);
    expect(pageBounds(8, 1, 4).totalPages).toBe(2);
  });

  it("computes the start index for a page", () => {
    expect(pageBounds(10, 1, 4).start).toBe(0);
    expect(pageBounds(10, 2, 4).start).toBe(4);
    expect(pageBounds(10, 3, 4).start).toBe(8);
  });
});
