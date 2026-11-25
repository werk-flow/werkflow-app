import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { DAY_MINUTES, openTimeArbitrary, openTimeFacts } from '@/lib/testing/time-correction-arbitraries';
import { createActivitySelection } from '@/lib/time-tracking/segments';
import { snapshotSegments, type SnapshotSegment } from './snapshot-segments';
import { splitCorrectionFactsAtMidnight } from './timeline-validation';

// Property tests (docs/technical/testing.md, "Property tests") of docs/features/time-tracking.md,
// "Corrections over midnight" and "Approval and corrections": each correction card lists the
// recorded and the proposed activities with their times and job. A proposal split at 00:00 Berlin
// reads as the activities that were proposed, with every minute.

const iso = (instant: number): string => new Date(instant).toISOString();

describe('The activities of a correction snapshot', () => {
  test('are the proposed activities with their times and job, also once split at midnight', () => {
    fc.assert(
      fc.property(openTimeArbitrary(DAY_MINUTES), fc.constantFrom('work', 'callout'), (time, kind) => {
        const facts = openTimeFacts(time, 'shift', {
          activityKind: kind,
          jobId: 'job',
          activity: createActivitySelection(kind, 'job'),
        });
        const work = (from: number, to: number): SnapshotSegment => ({
          startedAt: iso(from),
          endedAt: iso(to),
          activityKind: kind,
          jobId: 'job',
        });
        const proposed: SnapshotSegment[] = time.break
          ? [
              work(time.start, time.break.start),
              {
                startedAt: iso(time.break.start),
                endedAt: iso(time.break.end),
                activityKind: 'break',
                jobId: null,
              },
              work(time.break.end, time.end),
            ]
          : [work(time.start, time.end)];
        expect(snapshotSegments(facts)).toEqual(proposed);
        expect(snapshotSegments(splitCorrectionFactsAtMidnight(facts))).toEqual(proposed);
      }),
    );
  });
});
