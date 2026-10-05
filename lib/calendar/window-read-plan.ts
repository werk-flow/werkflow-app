import { rangeCovers, rangesEqual, type CalendarFetchRange } from './navigation';

/**
 * Which window the calendar's range owner reads, and when a running read
 * already answers a request. Both decisions keep one request pair per
 * window: a refresh never shrinks committed coverage, and concurrent
 * triggers share one current read.
 */

/**
 * The range to read: the one committed window when every dataset shares it
 * and it covers the request (a day-view edit refreshes the week or month it
 * sits in), otherwise the requested range. Separate windows never combine.
 */
export function windowRangeToRead(
  coverages: readonly (CalendarFetchRange | null)[],
  requestedRange: CalendarFetchRange,
): CalendarFetchRange {
  const [coverage] = coverages;
  if (!coverage || !rangeCovers(coverage, requestedRange)) return requestedRange;
  return coverages.every(
    (datasetCoverage) => datasetCoverage !== null && rangesEqual(datasetCoverage, coverage),
  )
    ? coverage
    : requestedRange;
}

/**
 * True when a running read may stand in for a new request: same scope and
 * range, every generation still current, and (for a Realtime catch-up) it
 * started after the invalidation it must cover.
 */
export function canReuseWindowRead<Dataset extends string>({
  running,
  scopeKey,
  range,
  invalidatedAt,
  datasets,
  currentGeneration,
}: {
  running: {
    scopeKey: string;
    startedAt: number;
    range: CalendarFetchRange;
    generations: Readonly<Record<Dataset, number>>;
  };
  scopeKey: string;
  range: CalendarFetchRange;
  invalidatedAt: number | undefined;
  datasets: readonly Dataset[];
  currentGeneration: (dataset: Dataset) => number;
}): boolean {
  return (
    running.scopeKey === scopeKey &&
    (invalidatedAt === undefined || running.startedAt > invalidatedAt) &&
    rangesEqual(running.range, range) &&
    datasets.every((dataset) => running.generations[dataset] === currentGeneration(dataset))
  );
}

/**
 * Why a window read runs. A `coverage` read only fills a window the view
 * needs. A `freshness` read covers an invalidation: a Realtime catch-up, the
 * read after the user's own mutation, or a manual refresh.
 */
export type WindowReadPurpose = 'coverage' | 'freshness';

/**
 * What the range owner does with a running read when the view needs a
 * window that its committed data already covers, for example after the user
 * navigates away and back before the read for the other window lands:
 *
 * - `keep`: the running read covers the needed window, or the needed window
 *   is not covered yet.
 * - `cancel`: the read only filled the other window. Committing it would
 *   replace the covered data and force a second read of the needed window.
 * - `replace`: the read covered an invalidation. Cancel it and read the
 *   needed window instead, because its committed data predates the
 *   invalidation.
 */
export function planRunningWindowRead({
  running,
  needed,
  neededCovered,
}: {
  running: { range: CalendarFetchRange; purpose: WindowReadPurpose } | null;
  needed: CalendarFetchRange;
  neededCovered: boolean;
}): 'keep' | 'cancel' | 'replace' {
  if (!running || !neededCovered || rangeCovers(running.range, needed)) return 'keep';
  return running.purpose === 'freshness' ? 'replace' : 'cancel';
}

/**
 * Runs a read again while it reports `superseded` and the caller still owns
 * its scope. A catch-up that navigation or the user's own mutation took over
 * is not a failed read: it follows the read that took over, which still
 * starts after the invalidation it must cover.
 */
export async function followSupersededReads<Outcome extends string>(
  read: () => Promise<Outcome | 'superseded'>,
  stillOwned: () => boolean,
): Promise<Outcome | 'superseded'> {
  let outcome = await read();
  while (outcome === 'superseded' && stillOwned()) outcome = await read();
  return outcome;
}
