import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import {
  MINUTE_MS,
  correctionFact,
  correctionStartArbitrary,
  recordedEntry,
} from '@/lib/testing/time-correction-arbitraries';
import type { TimeEntry, TimeEntryType } from '@/lib/time-tracking/types';
import { applyApprovedTimeCorrections } from './projection';
import type { TimeCorrectionApplicationProjection, TimeCorrectionFact } from './types';

// Property tests (docs/technical/testing.md, "Property tests") of docs/features/time-tracking.md,
// "Correction lifecycle": confirmed views show only accepted results and the original capture
// history stays intact. An approved correction replaces exactly its sources, and a correction of
// that correction back to the recorded times restores the recorded time.

type Session = { userId: string; start: number; end: number; canonical: boolean; index: number };

/** Sessions of two people in time order, each recorded as legacy entries or as one canonical segment. */
const sessionsArbitrary: fc.Arbitrary<Session[]> = fc
  .tuple(
    correctionStartArbitrary,
    fc.array(
      fc.record({
        userId: fc.constantFrom('person', 'other'),
        gap: fc.integer({ min: 1, max: 600 }),
        minutes: fc.integer({ min: 1, max: 600 }),
        canonical: fc.boolean(),
      }),
      { minLength: 1, maxLength: 6 },
    ),
  )
  .map(([first, draws]) => {
    let cursor = first;
    return draws.map((draw, index) => {
      const start = cursor + draw.gap * MINUTE_MS;
      cursor = start + draw.minutes * MINUTE_MS;
      return { userId: draw.userId, start, end: cursor, canonical: draw.canonical, index };
    });
  });

const entry = (session: Session, entryType: TimeEntryType, instant: number): TimeEntry =>
  recordedEntry(`entry-${session.index}-${entryType}`, entryType, instant, {
    userId: session.userId,
    ...(session.canonical
      ? { canonicalSegmentId: `segment-${session.index}`, sourceKind: 'canonical_segment' as const }
      : {}),
  });

const entriesOf = (session: Session): TimeEntry[] => [
  entry(session, 'clock_in', session.start),
  entry(session, 'clock_out', session.end),
];

const factsOf = (session: Session, start: number, end: number, prefix: string): TimeCorrectionFact[] => [
  correctionFact(`${prefix}-in`, 'clock_in', start, { userId: session.userId }),
  correctionFact(`${prefix}-out`, 'clock_out', end, { userId: session.userId }),
];

function application(
  applicationId: string,
  sources: TimeCorrectionApplicationProjection['sources'],
  facts: TimeCorrectionFact[],
): TimeCorrectionApplicationProjection {
  return {
    applicationId,
    requestId: applicationId,
    appliedAt: '2026-11-22T10:00:00Z',
    appliedBy: 'reviewer',
    sourceFingerprint: `fingerprint-${applicationId}`,
    snapshot: { schemaVersion: 1, facts },
    sources,
  };
}

/** The recorded time of entries, independent of ids and order: person, boundary and instant. */
const timeOf = (entries: readonly Pick<TimeEntry, 'userId' | 'entryType' | 'timestamp'>[]): string[] =>
  entries.map((item) => `${item.userId} ${item.entryType} ${Date.parse(item.timestamp)}`).sort();

/** Sessions, one of them corrected to new times anywhere within a day of its own. */
const correctionArbitrary = sessionsArbitrary.chain((sessions) =>
  fc.record({
    sessions: fc.constant(sessions),
    corrected: fc.constantFrom(...sessions),
    startShift: fc.integer({ min: -720, max: 720 }),
    minutes: fc.integer({ min: 1, max: 720 }),
  }),
);

function correctionOf(
  corrected: Session,
  startShift: number,
  minutes: number,
): TimeCorrectionApplicationProjection {
  const start = corrected.start + startShift * MINUTE_MS;
  return application(
    'correction',
    corrected.canonical
      ? [{ kind: 'canonical_segment', id: `segment-${corrected.index}`, version: 'v1' }]
      : entriesOf(corrected).map((item) => ({ kind: 'legacy_entry' as const, id: item.id, version: 'v1' })),
    factsOf(corrected, start, start + minutes * MINUTE_MS, 'corrected'),
  );
}

describe('Approved corrections over recorded time', () => {
  test('replace exactly their sources, leave all other time as recorded and change no input', () => {
    fc.assert(
      fc.property(correctionArbitrary, ({ sessions, corrected, startShift, minutes }) => {
        const entries = sessions.flatMap(entriesOf);
        const correction = correctionOf(corrected, startShift, minutes);
        const recorded = structuredClone(entries);
        const approved = structuredClone(correction);
        const projected = applyApprovedTimeCorrections(entries, [correction], 'org');
        expect(entries).toEqual(recorded);
        expect(correction).toEqual(approved);
        const untouched = sessions.filter((session) => session !== corrected).flatMap(entriesOf);
        const byId = (left: TimeEntry, right: TimeEntry) => left.id.localeCompare(right.id);
        expect(projected.filter((item) => !item.correctionApplicationId).sort(byId)).toEqual(
          untouched.sort(byId),
        );
        expect(timeOf(projected.filter((item) => item.correctionApplicationId === 'correction'))).toEqual(
          timeOf(correction.snapshot.facts),
        );
      }),
    );
  });

  test('followed by a correction back to the recorded times leave the recorded time unchanged', () => {
    fc.assert(
      fc.property(correctionArbitrary, ({ sessions, corrected, startShift, minutes }) => {
        const entries = sessions.flatMap(entriesOf);
        const correction = correctionOf(corrected, startShift, minutes);
        const inverse = application(
          'inverse',
          [
            {
              kind: 'correction_application',
              id: correction.applicationId,
              version: correction.sourceFingerprint,
            },
          ],
          factsOf(corrected, corrected.start, corrected.end, 'restored'),
        );
        expect(timeOf(applyApprovedTimeCorrections(entries, [correction, inverse], 'org'))).toEqual(
          timeOf(entries),
        );
      }),
    );
  });
});
