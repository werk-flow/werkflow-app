import { expect, test } from 'bun:test';
import {
  correctionTimelineWindow,
  exceedsLongestOpenTime,
  splitCorrectionFactsAtMidnight,
  validateCorrectionTimeline,
} from './timeline-validation';
import {
  correctionFactToEntry,
  type TimeCorrectionApplicationProjection,
  type TimeCorrectionFact,
} from './types';
import {
  createActivitySelection,
  projectTimeSegmentsToLegacyTransitions,
  type TimeSegmentFact,
} from '@/lib/time-tracking/segments';
import type { TimeEntryType } from '@/lib/time-tracking/types';

function interval(
  applicationId: string,
  userId: string,
  start: number,
  end: number,
): TimeCorrectionApplicationProjection {
  return {
    applicationId,
    requestId: applicationId,
    appliedAt: '2026-09-28T10:00:00Z',
    appliedBy: 'reviewer',
    sourceFingerprint: 'version',
    sources: [],
    snapshot: {
      schemaVersion: 1,
      facts: [start, end].map((hour, index) => ({
        factId: String(index),
        userId,
        employeeRecordId: userId,
        entryType: index === 0 ? 'clock_in' : 'clock_out',
        timestamp: `2026-09-08T${String(hour).padStart(2, '0')}:00:00Z`,
        jobId: null,
        activityKind: 'work',
        isManual: true,
      })),
    },
  };
}
const affectedDays = new Set(['person:2026-09-08', 'other:2026-09-08']);

test('a single midnight closing correction reads and validates the preceding Berlin day', () => {
  const original = interval('legacy', 'person', 6, 8);
  const opening = original.snapshot.facts[0];
  const closing = original.snapshot.facts[1];
  if (!opening || !closing) throw new Error('Missing boundary fixture.');
  const start = { ...opening, timestamp: '2026-09-07T22:05:00.000Z' };
  const end = { ...closing, timestamp: '2026-09-07T22:10:00.000Z' };
  const entries = [start, end].map((fact) => correctionFactToEntry(fact, original));
  const source = entries[1];
  if (!source) throw new Error('Missing closing entry.');
  const midnight = { ...end, timestamp: '2026-09-07T22:00:00.000Z' };
  const window = correctionTimelineWindow([end, midnight]);
  if (!window) throw new Error('Missing window.');
  expect([...window.affectedDays].sort()).toEqual(['person:2026-09-07', 'person:2026-09-08']);
  expect(window.from).toBe('2026-09-05T22:00:00.000Z');
  expect(window.to).toBe('2026-09-08T22:00:00.000Z');
  const candidate = {
    ...original,
    applicationId: 'candidate',
    sources: [{ kind: 'legacy_entry' as const, id: source.id, version: 'version' }],
    snapshot: { schemaVersion: 1 as const, facts: [midnight] },
  };
  expect(
    validateCorrectionTimeline({
      organizationId: 'org',
      affectedDays: window.affectedDays,
      entries,
      applications: [],
      candidates: [candidate],
    }),
  ).toBe('correction_timeline_conflict');
  const validOpening = {
    ...entries[0],
    ...correctionFactToEntry({ ...start, timestamp: '2026-09-07T20:00:00.000Z' }, original),
  };
  expect(
    validateCorrectionTimeline({
      organizationId: 'org',
      affectedDays: window.affectedDays,
      entries: [validOpening, source],
      applications: [],
      candidates: [candidate],
    }),
  ).toBeNull();
  const reassigned = { ...midnight, userId: 'other', employeeRecordId: 'other' };
  const reassignmentWindow = correctionTimelineWindow([end, reassigned]);
  if (!reassignmentWindow) throw new Error('Missing reassignment window.');
  expect(
    validateCorrectionTimeline({
      organizationId: 'org',
      affectedDays: reassignmentWindow.affectedDays,
      entries: [validOpening, source],
      applications: [],
      candidates: [{ ...candidate, snapshot: { schemaVersion: 1, facts: [reassigned] } }],
    }),
  ).toBe('correction_timeline_conflict');
});

test('a timeline window includes the next midnight across a Berlin DST day', () => {
  const fact = interval('window', 'person', 6, 8).snapshot.facts[0];
  if (!fact) throw new Error('Missing fact.');
  const window = correctionTimelineWindow([{ ...fact, timestamp: '2026-03-29T12:00:00.000Z' }]);
  expect(window?.from).toBe('2026-03-27T23:00:00.000Z');
  expect(window?.to).toBe('2026-03-29T22:00:00.000Z');
});

test('a resize is checked against surrounding effective time, after replacing its own source', () => {
  const original = interval('original', 'person', 6, 8);
  const neighbor = interval('neighbor', 'person', 9, 11);
  const candidate = {
    ...interval('candidate', 'person', 6, 10),
    sources: [{ kind: 'correction_application' as const, id: 'original', version: 'version' }],
  };
  const input = { organizationId: 'org', affectedDays, entries: [], applications: [original, neighbor] };
  expect(validateCorrectionTimeline({ ...input, candidates: [candidate] })).toBe(
    'correction_timeline_conflict',
  );
  expect(
    validateCorrectionTimeline({
      ...input,
      candidates: [{ ...candidate, snapshot: interval('candidate', 'person', 6, 8).snapshot }],
    }),
  ).toBeNull();
});

test('reassignment checks the destination and a batch composes candidates before acceptance', () => {
  const original = interval('original', 'person', 6, 8);
  const candidate = {
    ...interval('candidate', 'other', 6, 8),
    sources: [{ kind: 'correction_application' as const, id: 'original', version: 'version' }],
  };
  const input = { organizationId: 'org', affectedDays, entries: [], applications: [original] };
  expect(validateCorrectionTimeline({ ...input, candidates: [candidate] })).toBeNull();
  expect(
    validateCorrectionTimeline({ ...input, candidates: [candidate, interval('second', 'other', 7, 9)] }),
  ).toBe('correction_timeline_conflict');
});

test('changing one legacy boundary validates the remaining legacy sequence', () => {
  const original = interval('legacy', 'person', 6, 8);
  const entries = original.snapshot.facts.map((fact) => correctionFactToEntry(fact, original));
  const start = entries[0];
  if (!start) throw new Error('Missing fixture start.');
  const proposed = interval('candidate', 'person', 9, 10);
  proposed.snapshot.facts = proposed.snapshot.facts.slice(0, 1);
  proposed.sources = [{ kind: 'legacy_entry', id: start.id, version: 'version' }];
  expect(
    validateCorrectionTimeline({
      organizationId: 'org',
      affectedDays,
      entries,
      applications: [],
      candidates: [proposed],
    }),
  ).toBe('correction_timeline_conflict');
});

test('touching blocks close before opening even when their approval times differ', () => {
  const neighbor = { ...interval('older', 'person', 9, 11), appliedAt: '2026-09-09T10:00:00Z' };
  const candidate = interval('newer', 'person', 6, 9);
  expect(
    validateCorrectionTimeline({
      organizationId: 'org',
      affectedDays,
      entries: [],
      applications: [neighbor],
      candidates: [candidate],
    }),
  ).toBeNull();
});

test('an overnight canonical slice closing at Berlin midnight belongs to the previous day', () => {
  const overnight = interval('overnight', 'person', 20, 23);
  const start = overnight.snapshot.facts[0];
  const end = overnight.snapshot.facts[1];
  if (!start || !end) throw new Error('Missing overnight fixture.');
  const entries = [
    { ...start, factId: 'start', timestamp: '2026-09-07T21:00:00Z' },
    { ...end, factId: 'midnight-end', timestamp: '2026-09-07T22:00:00Z' },
    { ...start, factId: 'midnight-start', timestamp: '2026-09-07T22:00:00Z' },
    { ...end, factId: 'end', timestamp: '2026-09-07T23:00:00Z' },
  ].map((fact) => correctionFactToEntry(fact, overnight));
  expect(
    validateCorrectionTimeline({
      organizationId: 'org',
      affectedDays,
      entries,
      applications: [],
      candidates: [interval('candidate', 'person', 6, 8)],
    }),
  ).toBeNull();
});

test('real canonical break switches at midnight preserve valid sequences on both days', () => {
  for (const kinds of [
    ['work', 'break', 'work'],
    ['work', 'work', 'break'],
  ] as const) {
    const times = [
      '2026-09-07T21:00:00.000Z',
      '2026-09-07T21:30:00.000Z',
      '2026-09-07T22:00:00.000Z',
      '2026-09-07T23:00:00.000Z',
    ];
    const segments = kinds.map(
      (kind, index): TimeSegmentFact => ({
        ...createActivitySelection(kind),
        id: String(index),
        sessionId: 'session',
        organizationId: 'org',
        employeeRecordId: 'person',
        startedAt: times[index] ?? '',
        endedAt: times[index + 1] ?? null,
      }),
    );
    const application = interval('projected', 'person', 6, 8);
    const template = application.snapshot.facts[0];
    if (!template) throw new Error('Missing fact template.');
    const entries = projectTimeSegmentsToLegacyTransitions(
      segments,
      new Date('2026-09-07T00:00:00Z'),
      new Date('2026-09-09T00:00:00Z'),
    ).map((point, index) =>
      correctionFactToEntry(
        { ...template, factId: String(index), entryType: point.entryType, timestamp: point.timestamp },
        application,
      ),
    );
    expect(entries.filter((entry) => entry.timestamp === times[2]).map((entry) => entry.entryType)).toContain(
      'clock_in',
    );
    expect(
      validateCorrectionTimeline({
        organizationId: 'org',
        affectedDays: new Set(['person:2026-09-07', 'person:2026-09-08']),
        entries,
        applications: [],
        candidates: [interval('candidate', 'person', 6, 8)],
      }),
    ).toBeNull();
  }
});

// 20 and 21 October 2026 are summer time: Berlin midnight is 22:00 UTC.
const BERLIN_MIDNIGHT = '2026-10-20T22:00:00.000Z';

function fact(factId: string, entryType: TimeEntryType, timestamp: string): TimeCorrectionFact {
  return {
    factId,
    userId: 'person',
    employeeRecordId: 'person',
    entryType,
    timestamp,
    jobId: null,
    activityKind: 'work',
    isManual: true,
  };
}

function applied(applicationId: string, facts: TimeCorrectionFact[]): TimeCorrectionApplicationProjection {
  return { ...interval(applicationId, 'person', 6, 8), snapshot: { schemaVersion: 1, facts } };
}

function validateOvernight(
  facts: TimeCorrectionFact[],
  applications: TimeCorrectionApplicationProjection[] = [],
): ReturnType<typeof validateCorrectionTimeline> {
  const window = correctionTimelineWindow(facts);
  if (!window) throw new Error('Missing window.');
  return validateCorrectionTimeline({
    organizationId: 'org',
    affectedDays: window.affectedDays,
    entries: [],
    applications,
    candidates: [applied('candidate', facts)],
  });
}

const overnightShift = [
  fact('start', 'clock_in', '2026-10-20T20:00:00.000Z'),
  fact('end', 'clock_out', '2026-10-20T23:30:00.000Z'),
];

test('a missed overnight shift from 22:00 to 01:30 is split at Berlin midnight and accepted', () => {
  expect(validateOvernight(overnightShift)).toBe('correction_crosses_midnight');
  const split = splitCorrectionFactsAtMidnight(overnightShift);
  expect(split.map((boundary) => [boundary.entryType, boundary.timestamp])).toEqual([
    ['clock_in', '2026-10-20T20:00:00.000Z'],
    ['clock_out', BERLIN_MIDNIGHT],
    ['clock_in', BERLIN_MIDNIGHT],
    ['clock_out', '2026-10-20T23:30:00.000Z'],
  ]);
  expect(new Set(split.map((boundary) => boundary.factId)).size).toBe(split.length);
  expect([...(correctionTimelineWindow(split)?.affectedDays ?? [])].sort()).toEqual([
    'person:2026-10-20',
    'person:2026-10-21',
  ]);
  expect(validateOvernight(split)).toBeNull();
});

test('an overnight correction that overlaps recorded time on either day is still refused as an overlap', () => {
  const split = splitCorrectionFactsAtMidnight(overnightShift);
  for (const [start, end] of [
    ['2026-10-20T22:30:00.000Z', '2026-10-20T23:00:00.000Z'],
    ['2026-10-20T21:00:00.000Z', '2026-10-20T21:30:00.000Z'],
  ] as const) {
    const recorded = applied('recorded', [fact('a', 'clock_in', start), fact('b', 'clock_out', end)]);
    expect(validateOvernight(split, [recorded])).toBe('correction_timeline_conflict');
  }
});

test('a break across midnight closes and reopens at 00:00 like live capture', () => {
  const split = splitCorrectionFactsAtMidnight([
    fact('start', 'clock_in', '2026-10-20T19:00:00.000Z'),
    fact('pause', 'break_start', '2026-10-20T21:45:00.000Z'),
    fact('resume', 'break_end', '2026-10-20T22:15:00.000Z'),
    fact('end', 'clock_out', '2026-10-20T23:30:00.000Z'),
  ]);
  expect(split.filter((boundary) => boundary.timestamp === BERLIN_MIDNIGHT).map((b) => b.entryType)).toEqual([
    'break_end',
    'clock_out',
    'clock_in',
    'break_start',
  ]);
  expect(validateOvernight(split)).toBeNull();
});

test('the midnight split leaves day-bound and already split time unchanged and covers every midnight', () => {
  const toMidnight = [
    fact('start', 'clock_in', '2026-10-20T20:00:00.000Z'),
    fact('end', 'clock_out', BERLIN_MIDNIGHT),
  ];
  expect(splitCorrectionFactsAtMidnight(toMidnight)).toEqual(toMidnight);
  const split = splitCorrectionFactsAtMidnight(overnightShift);
  expect(splitCorrectionFactsAtMidnight(split)).toEqual(split);
  const twoNights = splitCorrectionFactsAtMidnight([
    fact('start', 'clock_in', '2026-10-20T20:00:00.000Z'),
    fact('end', 'clock_out', '2026-10-21T23:30:00.000Z'),
  ]);
  expect(twoNights.filter((boundary) => boundary.entryType === 'clock_out').map((b) => b.timestamp)).toEqual([
    BERLIN_MIDNIGHT,
    '2026-10-21T22:00:00.000Z',
    '2026-10-21T23:30:00.000Z',
  ]);
  expect(validateOvernight(twoNights)).toBeNull();
});

test('a lone clock-out that closes the previous day is refused with the midnight rule, not an overlap', () => {
  const opened = applied('opened', [fact('start', 'clock_in', '2026-10-20T20:00:00.000Z')]);
  const lateEnd = [fact('end', 'clock_out', '2026-10-20T23:30:00.000Z')];
  expect(splitCorrectionFactsAtMidnight(lateEnd)).toEqual(lateEnd);
  expect(validateOvernight(lateEnd, [opened])).toBe('correction_crosses_midnight');
});

test('open time over midnight may last at most 24 hours', () => {
  const shift = (start: string, end: string) => [
    fact('start', 'clock_in', start),
    fact('end', 'clock_out', end),
  ];
  expect(exceedsLongestOpenTime(overnightShift)).toBe(false);
  expect(exceedsLongestOpenTime(shift('2026-10-20T20:00:00.000Z', '2026-10-21T20:00:00.000Z'))).toBe(false);
  expect(exceedsLongestOpenTime(shift('2026-10-20T20:00:00.000Z', '2026-10-21T20:01:00.000Z'))).toBe(true);
  expect(exceedsLongestOpenTime(shift('2020-01-01T08:00:00.000Z', '2026-10-20T23:30:00.000Z'))).toBe(true);
  // A break does not restart the clock, and an open end still counts.
  expect(
    exceedsLongestOpenTime([
      fact('start', 'clock_in', '2026-10-20T06:00:00.000Z'),
      fact('pause', 'break_start', '2026-10-20T18:00:00.000Z'),
      fact('resume', 'break_end', '2026-10-21T06:01:00.000Z'),
    ]),
  ).toBe(true);
  // A clock_in that resumes work after a break keeps the original start.
  expect(
    exceedsLongestOpenTime([
      fact('start', 'clock_in', '2026-10-20T06:00:00.000Z'),
      fact('pause', 'break_start', '2026-10-20T12:00:00.000Z'),
      fact('resume', 'break_end', '2026-10-20T12:30:00.000Z'),
      fact('switch', 'clock_in', '2026-10-20T12:30:00.000Z'),
      fact('end', 'clock_out', '2026-10-21T06:01:00.000Z'),
    ]),
  ).toBe(true);
  // A resumed clock_in without a later clock_out still counts from the original start.
  expect(
    exceedsLongestOpenTime([
      fact('start', 'clock_in', '2026-10-20T06:00:00.000Z'),
      fact('pause', 'break_start', '2026-10-20T12:00:00.000Z'),
      fact('resume', 'break_end', '2026-10-20T12:30:00.000Z'),
      fact('switch', 'clock_in', '2026-10-21T06:01:00.000Z'),
    ]),
  ).toBe(true);
  // A clock_in after a clock_out starts new time.
  expect(
    exceedsLongestOpenTime([
      fact('first', 'clock_in', '2026-10-20T06:00:00.000Z'),
      fact('first-end', 'clock_out', '2026-10-20T14:00:00.000Z'),
      fact('second', 'clock_in', '2026-10-20T20:00:00.000Z'),
      fact('second-end', 'clock_out', '2026-10-21T06:00:00.000Z'),
    ]),
  ).toBe(false);
  // The whole 25-hour day of the autumn clock change, as a recorded session's day piece.
  expect(exceedsLongestOpenTime(shift('2026-10-24T22:00:00.000Z', '2026-10-25T23:00:00.000Z'))).toBe(false);
});
