/**
 * Demo pagination helper (TARS Slice 2 verification fixture).
 *
 * Computes the slice bounds for a page of items. NOTE: this file is a
 * throwaway used to exercise the autonomous fix pipeline end-to-end. It is
 * deleted as part of verification cleanup.
 */

export interface PageBounds {
  start: number;
  end: number;
  totalPages: number;
}

/**
 * Return the [start, end) slice indices for a 1-based page.
 *
 * `end` is clamped to `totalItems` so the final page never over-runs the
 * array and callers can rely on `end` as a precise cursor value.
 */
export function pageBounds(
  totalItems: number,
  page: number,
  pageSize: number
): PageBounds {
  const start = (page - 1) * pageSize;
  const end = Math.min(start + pageSize, totalItems);
  const totalPages = Math.ceil(totalItems / pageSize);
  return { start, end, totalPages };
}

/** Slice a page of items using {@link pageBounds}. */
export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const { start, end } = pageBounds(items.length, page, pageSize);
  return items.slice(start, end);
}
