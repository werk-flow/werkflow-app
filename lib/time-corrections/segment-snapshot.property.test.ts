import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { berlinMidnightMs } from '@/lib/testing/berlin-arbitraries';
import {
  MINUTE_MS,
  correctionStartArbitrary,
  oracleBerlinDate,
  recordedEntry,
} from '@/lib/testing/time-correction-arbitraries';
import {
  createActivitySelection,
  projectTimeSegmentsToLegacyTransitions,
  type TimeSegmentFact,
} from '@/lib/time-tracking/segments';
import type { TimeEntry, TimeSegmentKind } from '@/lib/time-tracking/types';
import { applyApprovedTimeCorrections } from './projection';
import { createSegmentCorrectionSnapshot } from './segment-snapshot';

// Property tests (docs/technical/testing.md, "Property tests") of docs/features/time-tracking.md,
// "Corrections" and "Correction lifecycle": a correction of one recorded activity starts from that
// activity's own clock facts, so an approved correction that changes nothing leaves the recorded
// time as it was and the original capture history intact.

/** One clock session of contiguous segments, a break between two activities now and then. */
const sessionArbitrary = fc
  .tuple(
    correctionStartArbitrary,
    fc.array(
      fc.record({
        kind: fc.constantFrom<TimeSegmentKind>('work', 'travel', 'standby', 'callout', 'internal_activity'),
        job: fc.constantFrom('job-a', null),
        minutes: fc.integer({ min: 1, max: 600 }),
        breakAfter: fc.option(fc.integer({ min: 1, max: 60 }), { nil: null }),
      }),
      { minLength: 1, maxLength: 4 },
    ),
  )
  .map(([start, draws]) => {
    let cursor = start;
    const segment = (kind: TimeSegmentKind, job: string | null, minutes: number): TimeSegmentFact => {
      const startedAt = cursor;
      cursor += minutes * MINUTE_MS;
      return {
        ...createActivitySelection(kind, job),
        id: `segment-${startedAt}`,
        sessionId: 'session',
        organizationId: 'org',
        employeeRecordId: 'person-record',
        startedAt: new Date(startedAt).toISOString(),
        endedAt: new Date(cursor).toISOString(),
      };
    };
    return draws.flatMap((draw, index) => [
      segment(draw.kind, draw.job, draw.minutes),
      ...(draw.breakAfter && index < draws.length - 1 ? [segment('break', null, draw.breakAfter)] : []),
    ]);
  });

const timeOf = (entries: readonly TimeEntry[]): string[] =>
  entries.map((item) => `${item.entryType} ${Date.parse(item.timestamp)}`).sort();

describe('The clock facts a correction of one recorded activity starts from', () => {
  test('lie on the activity’s start, end or a Berlin midnight inside it, with its activity, job and person', () => {
    fc.assert(
      fc.property(sessionArbitrary, fc.nat(), (session, pick) => {
        const segment = session[pick % session.length];
        if (!segment?.endedAt) throw new Error('Every drawn segment has ended.');
        const start = Date.parse(segment.startedAt);
        const end = Date.parse(segment.endedAt);
        const snapshot = createSegmentCorrectionSnapshot(segment, session, 'person', new Date(end));
        expect(snapshot.facts[0]?.timestamp).toBe(segment.startedAt);
        for (const fact of snapshot.facts) {
          const instant = Date.parse(fact.timestamp);
          expect(instant).toBeGreaterThanOrEqual(start);
          expect(instant).toBeLessThanOrEqual(end);
          if (instant !== start && instant !== end)
            expect(berlinMidnightMs(oracleBerlinDate(instant))).toBe(instant);
          expect(fact).toMatchObject({
            userId: 'person',
            employeeRecordId: 'person-record',
            activityKind: segment.kind,
            jobId: 'jobId' in segment ? (segment.jobId ?? null) : null,
          });
        }
      }),
    );
  });

  test('replace exactly the activity’s recorded facts, so an unchanged correction keeps the recorded time', () => {
    fc.assert(
      fc.property(sessionArbitrary, fc.nat(), (session, pick) => {
        const segment = session[pick % session.length];
        const last = session.at(-1);
        if (!segment || !last?.endedAt) throw new Error('Every drawn segment has ended.');
        const reference = new Date(last.endedAt);
        const recorded = projectTimeSegmentsToLegacyTransitions(
          session,
          new Date(session[0]?.startedAt ?? last.endedAt),
          reference,
          reference,
        ).map((point, index) =>
          recordedEntry(`entry-${index}`, point.entryType, Date.parse(point.timestamp), {
            canonicalSegmentId: point.segmentId,
            sourceKind: 'canonical_segment',
          }),
        );
        const unchanged = {
          applicationId: 'unchanged',
          requestId: 'unchanged',
          appliedAt: reference.toISOString(),
          appliedBy: 'reviewer',
          sourceFingerprint: 'version',
          sources: [{ kind: 'canonical_segment' as const, id: segment.id, version: 'version' }],
          snapshot: createSegmentCorrectionSnapshot(segment, session, 'person', reference),
        };
        expect(timeOf(applyApprovedTimeCorrections(recorded, [unchanged], 'org'))).toEqual(timeOf(recorded));
      }),
    );
  });
});
