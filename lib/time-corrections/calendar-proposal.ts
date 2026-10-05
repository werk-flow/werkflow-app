import type { ActionResult } from '@/lib/action-result';
import type { TimeCorrectionSnapshot, TimeCorrectionSource } from './types';
import type { CalendarCorrectionBoundary } from './validation';
import {
  projectTimeSegmentsToLegacyTransitions,
  toTimeActivitySelection,
  type TimeSegmentFact,
} from '@/lib/time-tracking/segments';

/** Replace complete sources once; never discard boundaries hidden by a calendar projection. */
export function proposeCalendarCorrection(input: {
  contexts: readonly {
    source: TimeCorrectionSource | null;
    snapshot: TimeCorrectionSnapshot;
    segment?: TimeSegmentFact;
  }[];
  boundaries: readonly CalendarCorrectionBoundary[];
}): ActionResult<{ before: TimeCorrectionSnapshot; snapshot: TimeCorrectionSnapshot }> {
  const facts: TimeCorrectionSnapshot['facts'] = [];
  const before: TimeCorrectionSnapshot['facts'] = [];
  const segments = input.contexts.flatMap((context) => (context.segment ? [context.segment] : []));
  if (segments.some((segment) => !segment.endedAt))
    return { success: false, error: 'calendar_incomplete_source' };
  const points = segments.length
    ? projectTimeSegmentsToLegacyTransitions(
        segments,
        new Date(Math.min(...segments.map((segment) => Date.parse(segment.startedAt)))),
        new Date(Math.max(...segments.map((segment) => Date.parse(segment.endedAt ?? segment.startedAt)))),
      )
    : [];
  const normalizeVersion = (value: string): string =>
    value
      .replace('T', ' ')
      .replace(/Z$/, '+00')
      .replace(/\+00:00$/, '+00');
  for (const context of input.contexts) {
    const source = context.source;
    if (!source) return { success: false, error: 'source_not_found' };
    const boundaries = input.boundaries.filter(
      (boundary) => boundary.source.kind === source.kind && boundary.source.id === source.id,
    );
    if (
      boundaries.some(
        (boundary) => normalizeVersion(boundary.source.version) !== normalizeVersion(source.version),
      )
    ) {
      return { success: false, error: 'time_correction_stale_source' };
    }
    const template = context.snapshot.facts[0];
    const sourceFacts =
      context.segment && template
        ? points
            .filter((point) => point.segmentId === source.id)
            .map((point, index) => ({
              ...template,
              ...(context.segment ? { activity: toTimeActivitySelection(context.segment) } : {}),
              factId: `${source.id}:${index}`,
              entryType: point.entryType,
              timestamp: point.timestamp,
            }))
        : context.snapshot.facts;
    if (boundaries.length !== sourceFacts.length) {
      return { success: false, error: 'calendar_incomplete_source' };
    }
    const matched = new Set<CalendarCorrectionBoundary>();
    for (const fact of sourceFacts) {
      const matches = boundaries.filter(
        (boundary) =>
          boundary.entryType === fact.entryType &&
          Date.parse(boundary.originalTimestamp) === Date.parse(fact.timestamp),
      );
      const boundary = matches[0];
      if (matches.length !== 1 || !boundary || matched.has(boundary))
        return { success: false, error: 'calendar_incomplete_source' };
      matched.add(boundary);
      before.push(fact);
      facts.push({
        ...fact,
        factId: `${source.id}:${facts.length}`,
        timestamp: boundary.timestamp,
        employeeRecordId: boundary.employeeRecordId,
      });
    }
  }
  // A live/open block must be ended through the clock workflow first.
  const ordered = [...facts].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  const first = ordered[0];
  const last = ordered.at(-1);
  if (
    !first ||
    !last ||
    !['clock_in', 'break_start'].includes(first.entryType) ||
    !['clock_out', 'break_end'].includes(last.entryType)
  ) {
    return { success: false, error: 'calendar_incomplete_source' };
  }
  const boundaryOrder = { break_end: 0, clock_out: 1, clock_in: 2, break_start: 3 };
  const originalOrder = before
    .map((fact, index) => ({ fact, proposed: facts[index] }))
    .sort(
      (left, right) =>
        Date.parse(left.fact.timestamp) - Date.parse(right.fact.timestamp) ||
        boundaryOrder[left.fact.entryType] - boundaryOrder[right.fact.entryType],
    );
  return {
    success: true,
    before: {
      schemaVersion: 1,
      facts: originalOrder.map(({ fact }, index) => ({ ...fact, factId: String(index).padStart(3, '0') })),
    },
    snapshot: {
      schemaVersion: 1,
      facts: originalOrder.flatMap(({ proposed }, index) =>
        proposed ? [{ ...proposed, factId: String(index).padStart(3, '0') }] : [],
      ),
    },
  };
}
