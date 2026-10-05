import { expect, test } from 'bun:test';
import { correctionTimelineWindow, validateCorrectionTimeline } from './timeline-validation';
import { correctionFactToEntry, type TimeCorrectionApplicationProjection } from './types';
import {
  createActivitySelection,
  projectTimeSegmentsToLegacyTransitions,
  type TimeSegmentFact,
} from '@/lib/time-tracking/segments';

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
  expect(window.from).toBe('2026-09-06T22:00:00.000Z');
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
  ).toBe(false);
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
  ).toBe(true);
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
  ).toBe(false);
});

test('a timeline window includes the next midnight across a Berlin DST day', () => {
  const fact = interval('window', 'person', 6, 8).snapshot.facts[0];
  if (!fact) throw new Error('Missing fact.');
  const window = correctionTimelineWindow([{ ...fact, timestamp: '2026-03-29T12:00:00.000Z' }]);
  expect(window?.from).toBe('2026-03-28T23:00:00.000Z');
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
  expect(validateCorrectionTimeline({ ...input, candidates: [candidate] })).toBe(false);
  expect(
    validateCorrectionTimeline({
      ...input,
      candidates: [{ ...candidate, snapshot: interval('candidate', 'person', 6, 8).snapshot }],
    }),
  ).toBe(true);
});

test('reassignment checks the destination and a batch composes candidates before acceptance', () => {
  const original = interval('original', 'person', 6, 8);
  const candidate = {
    ...interval('candidate', 'other', 6, 8),
    sources: [{ kind: 'correction_application' as const, id: 'original', version: 'version' }],
  };
  const input = { organizationId: 'org', affectedDays, entries: [], applications: [original] };
  expect(validateCorrectionTimeline({ ...input, candidates: [candidate] })).toBe(true);
  expect(
    validateCorrectionTimeline({ ...input, candidates: [candidate, interval('second', 'other', 7, 9)] }),
  ).toBe(false);
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
  ).toBe(false);
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
  ).toBe(true);
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
  ).toBe(true);
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
    ).toBe(true);
  }
});
