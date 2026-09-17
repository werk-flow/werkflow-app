/**
 * Bounded id-list reads (Step 2, PF-21). PostgREST receives `.in('id', ids)`
 * as a GET query string; the API gateway rejects long ones ("URI too long"),
 * which the typical data profile reached with about 360 job ids in one
 * calendar window. A batch of 100 UUIDs is about 3.7 KB and is the size the
 * planning assignment loader already used safely.
 */
export const ID_BATCH_SIZE = 100;

export function chunkIds(ids: readonly string[], size = ID_BATCH_SIZE): string[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error("A batch size must be a positive integer.");
  const unique = [...new Set(ids)];
  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += size) {
    chunks.push(unique.slice(index, index + size));
  }
  return chunks;
}

/** Batches in flight at once; 2,500 ids are 25 batches, not 25 parallel connections. */
export const BATCH_CONCURRENCY = 8;

/**
 * Runs one query per batch, at most `BATCH_CONCURRENCY` at a time, and
 * concatenates the rows in id order. The first error wins; callers keep their
 * existing error handling.
 */
export async function readInBatches<Row, ReadError extends { message: string }>(
  ids: readonly string[],
  read: (batch: readonly string[]) => PromiseLike<{ data: Row[] | null; error: ReadError | null }>,
  size = ID_BATCH_SIZE,
): Promise<{ data: Row[]; error: ReadError | null }> {
  const batches = chunkIds(ids, size);
  const rows: Row[] = [];
  for (let index = 0; index < batches.length; index += BATCH_CONCURRENCY) {
    const window = batches.slice(index, index + BATCH_CONCURRENCY);
    const results = await Promise.all(window.map((batch) => read(batch)));
    const failed = results.find((result) => result.error);
    if (failed?.error) return { data: [], error: failed.error };
    for (const result of results) rows.push(...(result.data ?? []));
  }
  return { data: rows, error: null };
}

/**
 * PostgREST caps every response at the project's `max_rows` (1,000 on the
 * local stack and on hosted projects by default) and truncates silently, so
 * an unpaged organization read of 2,500 jobs returns 1,000 rows and no error
 * (Step 2, PF-25). Page size equals the cap: a shorter page is the true end.
 */
export const ROW_PAGE_SIZE = 1_000;

/**
 * Reads every row through `range` pages until a short page, or reports an
 * overflow once more than `cap` rows exist. The page builder must apply a
 * deterministic order (end with an `id` tiebreaker) or pages can overlap.
 */
export async function readAllRows<Row, ReadError extends { message: string }>(
  page: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: ReadError | null }>,
  options: { cap: number },
): Promise<{ data: Row[]; error: ReadError | null; overflow: boolean }> {
  if (!Number.isInteger(options.cap) || options.cap < 1) throw new Error("A row cap must be a positive integer.");
  const rows: Row[] = [];
  for (let from = 0; ; from += ROW_PAGE_SIZE) {
    const result = await page(from, from + ROW_PAGE_SIZE - 1);
    if (result.error) return { data: [], error: result.error, overflow: false };
    const batch = result.data ?? [];
    rows.push(...batch);
    if (rows.length > options.cap) return { data: [], error: null, overflow: true };
    if (batch.length < ROW_PAGE_SIZE) return { data: rows, error: null, overflow: false };
  }
}

/**
 * Declared bound for whole-organization list pages. Above it a page reports
 * the overflow instead of rendering a partial list; a reviewed server search
 * or pagination is the next step (Step 2 plan, PF-10).
 */
export const LIST_ROW_CAP = 10_000;

/** Complete bounded reads whose overflow follows the same failure path as a query error. */
export async function readCompleteRows<Row, ReadError extends { message: string }>(
  page: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: ReadError | null }>,
  cap: number,
): Promise<{ data: Row[]; error: ReadError | { code: 'row_overflow'; message: string } | null }> {
  const result = await readAllRows(page, { cap });
  return result.overflow
    ? { data: [], error: { code: 'row_overflow', message: 'The complete read exceeded its declared row bound.' } }
    : { data: result.data, error: result.error };
}
