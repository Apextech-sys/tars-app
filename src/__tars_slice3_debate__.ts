// Synthetic throwaway module for TARS Slice 3 debate verification.
// Contains a deliberate, subtle pagination bug.

export interface Page<T> {
  items: T[];
  page: number;
  totalPages: number;
}

/**
 * Return a single page (1-indexed) of `items`.
 */
export function paginate<T>(
  items: T[],
  page: number,
  pageSize: number
): Page<T> {
  const totalPages = Math.ceil(items.length / pageSize);
  // BUG: upper clamp uses totalPages (1-indexed) but start uses 0-indexed math
  // with an off-by-one — the last page silently drops its final element.
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = (safePage - 1) * pageSize;
  const end = start + pageSize - 1;
  return {
    items: items.slice(start, end),
    page: safePage,
    totalPages,
  };
}
