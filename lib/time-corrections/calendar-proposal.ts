import type { ActionResult } from '@/lib/action-result';
import {
  normalizeTimestampSourceVersion,
  type TimeCorrectionFact,
  type TimeCorrectionSnapshot,
  type TimeCorrectionSource,
} from './types';
import type { CalendarCorrectionBoundary } from './validation';
import {
  projectTimeSegmentsToLegacyTransitions,
  toTimeActivitySelection,
  type TimeSegmentFact,
} from '@/lib/time-tracking/segments';

type ProposalContext = {
  source: TimeCorrectionSource | null;
  snapshot: TimeCorrectionSnapshot;
  segment?: TimeSegmentFact;
};

type LegacyTransition = ReturnType<typeof projectTimeSegmentsToLegacyTransitions>[number];

/** The before and proposed facts gathered so far, pair by pair in the same order. */
type ProposalFacts = { before: TimeCorrectionFact[]; facts: TimeCorrectionFact[] };

/** The legacy transitions of the segment sources, across the span they cover together. */
function segmentTransitions(segments: readonly TimeSegmentFact[]): LegacyTransition[] {
  return segments.length
    ? projectTimeSegmentsToLegacyTransitions(
        segments,
        new Date(Math.min(...segments.map((segment) => Date.parse(segment.startedAt)))),
        new Date(Math.max(...segments.map((segment) => Date.parse(segment.endedAt ?? segment.startedAt)))),
      )
    : [];
}

/** A source's facts: a segment's as the calendar shows its transitions, any other source's as stored. */
function sourceFactsOf(
  context: ProposalContext,
  source: TimeCorrectionSource,
  points: readonly LegacyTransition[],
): TimeCorrectionFact[] {
  const template = context.snapshot.facts[0];
  return context.segment && template
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
}

/**
 * Moves each fact of one source to the boundary that names it, exactly once,
 * appending to `proposal`; the refusal when a boundary is stale, missing or
 * ambiguous.
 */
function proposeSourceFacts(
  context: ProposalContext,
  allBoundaries: readonly CalendarCorrectionBoundary[],
  points: readonly LegacyTransition[],
  proposal: ProposalFacts,
): string | null {
  const source = context.source;
  if (!source) return 'source_not_found';
  const boundaries = allBoundaries.filter(
    (boundary) => boundary.source.kind === source.kind && boundary.source.id === source.id,
  );
  if (
    boundaries.some(
      (boundary) =>
        normalizeTimestampSourceVersion(boundary.source.version) !==
        normalizeTimestampSourceVersion(source.version),
    )
  ) {
    return 'time_correction_stale_source';
  }
  const sourceFacts = sourceFactsOf(context, source, points);
  if (boundaries.length !== sourceFacts.length) return 'calendar_incomplete_source';
  const matched = new Set<CalendarCorrectionBoundary>();
  for (const fact of sourceFacts) {
    const matches = boundaries.filter(
      (boundary) =>
        boundary.entryType === fact.entryType &&
        Date.parse(boundary.originalTimestamp) === Date.parse(fact.timestamp),
    );
    const boundary = matches[0];
    if (matches.length !== 1 || !boundary || matched.has(boundary)) return 'calendar_incomplete_source';
    matched.add(boundary);
    proposal.before.push(fact);
    proposal.facts.push({
      ...fact,
      factId: `${source.id}:${proposal.facts.length}`,
      timestamp: boundary.timestamp,
      employeeRecordId: boundary.employeeRecordId,
    });
  }
  return null;
}

/** Both snapshots in the original facts' order, with fact ids numbered in that order. */
function orderedSnapshots({ before, facts }: ProposalFacts): {
  before: TimeCorrectionSnapshot;
  snapshot: TimeCorrectionSnapshot;
} {
  const boundaryOrder = { break_end: 0, clock_out: 1, clock_in: 2, break_start: 3 };
  const originalOrder = before
    .map((fact, index) => ({ fact, proposed: facts[index] }))
    .sort(
      (left, right) =>
        Date.parse(left.fact.timestamp) - Date.parse(right.fact.timestamp) ||
        boundaryOrder[left.fact.entryType] - boundaryOrder[right.fact.entryType],
    );
  return {
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

/** Replace complete sources once; never discard boundaries hidden by a calendar projection. */
export function proposeCalendarCorrection(input: {
  contexts: readonly ProposalContext[];
  boundaries: readonly CalendarCorrectionBoundary[];
}): ActionResult<{ before: TimeCorrectionSnapshot; snapshot: TimeCorrectionSnapshot }> {
  const proposal: ProposalFacts = { before: [], facts: [] };
  const segments = input.contexts.flatMap((context) => (context.segment ? [context.segment] : []));
  if (segments.some((segment) => !segment.endedAt))
    return { success: false, error: 'calendar_incomplete_source' };
  const points = segmentTransitions(segments);
  for (const context of input.contexts) {
    const refusal = proposeSourceFacts(context, input.boundaries, points, proposal);
    if (refusal) return { success: false, error: refusal };
  }
  // A live/open block must be ended through the clock workflow first.
  const ordered = [...proposal.facts].sort(
    (left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp),
  );
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
  return { success: true, ...orderedSnapshots(proposal) };
}
