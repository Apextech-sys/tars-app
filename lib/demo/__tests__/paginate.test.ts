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

  // Regression tests for the off-by-one in `end` (was start + pageSize + 1).
  it("end equals start + pageSize for full pages", () => {
    expect(pageBounds(10, 1, 4).end).toBe(4); // page 1: [0,4)
    expect(pageBounds(10, 2, 4).end).toBe(8); // page 2: [4,8)
  });

  it("end is clamped to totalItems on the final page", () => {
    // 10 items, pageSize 4 → last page is [8,10), not [8,11)
    expect(pageBounds(10, 3, 4).end).toBe(10);
    // 8 items, pageSize 4 → last page is [4,8)
    expect(pageBounds(8, 2, 4).end).toBe(8);
  });

  it("pages do not overlap", () => {
    const p1 = pageBounds(10, 1, 4);
    const p2 = pageBounds(10, 2, 4);
    // page 1 end must equal page 2 start — no overlap, no gap
    expect(p1.end).toBe(p2.start);
  });
});

describe("paginate", () => {
  const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  it("returns the correct items for a full page", () => {
    expect(paginate(items, 1, 4)).toEqual([0, 1, 2, 3]);
    expect(paginate(items, 2, 4)).toEqual([4, 5, 6, 7]);
  });

  it("returns only the remaining items on the final page", () => {
    // page 3 of 10 items with pageSize 4 → [8,9]
    expect(paginate(items, 3, 4)).toEqual([8, 9]);
  });

  it("page 1 and page 2 do not share any items", () => {
    const p1 = paginate(items, 1, 4);
    const p2 = paginate(items, 2, 4);
    const overlap = p1.filter((x) => p2.includes(x));
    expect(overlap).toHaveLength(0);
  });
});
