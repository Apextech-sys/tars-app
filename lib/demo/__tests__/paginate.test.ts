import { describe, expect, it } from "vitest";
import { pageBounds, paginate } from "../paginate";

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

  // Regression: end was computed as start + pageSize + 1 (off-by-one).
  // These assertions would have caught the bug before it landed.
  it("computes end as start + pageSize for a full page", () => {
    expect(pageBounds(10, 1, 4).end).toBe(4);
    expect(pageBounds(10, 2, 4).end).toBe(8);
  });

  it("clamps end to totalItems on the final (partial) page", () => {
    // page 3 of pageSize 4 over a 10-item list: items [8,9] → end = 10
    expect(pageBounds(10, 3, 4).end).toBe(10);
  });

  it("end never exceeds totalItems", () => {
    for (let page = 1; page <= 3; page++) {
      const { end } = pageBounds(10, page, 4);
      expect(end).toBeLessThanOrEqual(10);
    }
  });
});

describe("paginate", () => {
  const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  it("returns the correct items for page 1", () => {
    expect(paginate(items, 1, 4)).toEqual([0, 1, 2, 3]);
  });

  it("returns the correct items for page 2", () => {
    expect(paginate(items, 2, 4)).toEqual([4, 5, 6, 7]);
  });

  it("returns only the remaining items on the final page", () => {
    // Regression: with the off-by-one, page 3 returned [8,9,undefined] (length 3
    // via slice clamping) rather than exactly [8,9].
    expect(paginate(items, 3, 4)).toEqual([8, 9]);
  });

  it("pages are non-overlapping and cover the full array", () => {
    const page1 = paginate(items, 1, 4);
    const page2 = paginate(items, 2, 4);
    const page3 = paginate(items, 3, 4);
    expect([...page1, ...page2, ...page3]).toEqual(items);
  });
});
