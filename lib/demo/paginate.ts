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
 * BUG (deliberate, for the fix-stage E2E): `end` is computed as
 * `start + pageSize + 1`, an off-by-one that returns one item too many per
 * page (and overruns the array on the last page).
 */
export function pageBounds(
  totalItems: number,
  page: number,
  pageSize: number
): PageBounds {
  const start = (page - 1) * pageSize;
  const end = start + pageSize + 1; // off-by-one: should be start + pageSize
  const totalPages = Math.ceil(totalItems / pageSize);
  return { start, end, totalPages };
}

/** Slice a page of items using {@link pageBounds}. */
export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const { start, end } = pageBounds(items.length, page, pageSize);
  return items.slice(start, end);
}
