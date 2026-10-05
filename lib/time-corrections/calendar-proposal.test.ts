import { expect, test } from 'bun:test';
import { mergeCorrectionProposal } from './merge-proposal';
import { proposeCalendarCorrection } from './calendar-proposal';
import type { TimeCorrectionFact, TimeCorrectionSource } from './types';
import type { CalendarCorrectionBoundary } from './validation';
import type { TimeSegmentFact } from '@/lib/time-tracking/segments';
import { applyApprovedTimeCorrections } from './projection';
import { buildLegacyIntervals } from '@/lib/time-accounts/legacy-intervals';

const dateAt = (hour: number): string => `2026-09-08T${String(hour).padStart(2, '0')}:00:00.000Z`;
const version = dateAt(17);
function contextFor(id: string, start: number, end: number | null, kind: 'work' | 'break' = 'work') {
  const segment: TimeSegmentFact = {
    id,
    sessionId: 'session',
    organizationId: 'org',
    employeeRecordId: 'person',
    startedAt: dateAt(start),
    endedAt: end === null ? null : dateAt(end),
    ...(kind === 'work'
      ? ({ kind, allocationKind: 'job', jobId: 'job' } as const)
      : ({ kind, allocationKind: 'none' } as const)),
  };
  const source: TimeCorrectionSource = { id, kind: 'canonical_segment', version };
  const first: TimeCorrectionFact = {
    factId: `${id}:start`,
    employeeRecordId: 'person',
    userId: 'user',
    entryType: kind === 'work' ? 'clock_in' : 'break_start',
    timestamp: dateAt(start),
    jobId: kind === 'work' ? 'job' : null,
    activityKind: kind,
    isManual: false,
  };
  return {
    source,
    segment,
    snapshot: {
      schemaVersion: 1 as const,
      facts: [
        first,
        ...(end === null
          ? []
          : [
              {
                ...first,
                factId: `${id}:end`,
                entryType: kind === 'work' ? ('clock_out' as const) : ('break_end' as const),
                timestamp: dateAt(end),
              },
            ]),
      ],
    },
  };
}
function boundary(
  id: string,
  entryType: CalendarCorrectionBoundary['entryType'],
  hour: number,
  proposedHour = hour + 1,
): CalendarCorrectionBoundary {
  return {
    source: { kind: 'canonical_segment', id, version },
    entryType,
    originalTimestamp: dateAt(hour),
    timestamp: dateAt(proposedHour),
    employeeRecordId: 'target',
  };
}

test('a work/break/work block keeps the real projection and all activity metadata in one correction', () => {
  const result = proposeCalendarCorrection({
    contexts: [contextFor('first', 6, 8), contextFor('break', 8, 9, 'break'), contextFor('last', 9, 11)],
    boundaries: [
      boundary('first', 'clock_in', 6),
      boundary('break', 'break_start', 8),
      boundary('last', 'break_end', 9),
      boundary('last', 'clock_out', 11),
    ],
  });
  expect(result.success).toBe(true);
  if (!result.success) throw new Error(result.error);
  expect(result.snapshot.facts.map((fact) => fact.entryType)).toEqual([
    'clock_in',
    'break_start',
    'break_end',
    'clock_out',
  ]);
  expect(result.snapshot.facts.map((fact) => fact.timestamp)).toEqual([
    dateAt(7),
    dateAt(9),
    dateAt(10),
    dateAt(12),
  ]);
  expect(result.snapshot.facts.map((fact) => fact.jobId)).toEqual(['job', null, 'job', 'job']);
  expect(result.snapshot.facts.every((fact) => fact.employeeRecordId === 'target')).toBe(true);
  expect(result.before.facts[0]?.timestamp).toBe(dateAt(6));
});

test('resizing preserves all unchanged interior boundaries', () => {
  const result = proposeCalendarCorrection({
    contexts: [contextFor('work', 6, 8)],
    boundaries: [boundary('work', 'clock_in', 6, 6), boundary('work', 'clock_out', 8, 9)],
  });
  if (!result.success) throw new Error(result.error);
  expect(result.snapshot.facts.map((fact) => fact.timestamp)).toEqual([dateAt(6), dateAt(9)]);
});

test('stale versions, clipped boundaries, duplicates and live segments cannot become a replacement', () => {
  const contexts = [contextFor('work', 6, 8)];
  const boundaries = [boundary('work', 'clock_in', 6), boundary('work', 'clock_out', 8)];
  const start = boundaries[0];
  if (!start) throw new Error('Missing start');
  expect(
    proposeCalendarCorrection({
      contexts,
      boundaries: [
        { ...start, source: { ...start.source, version: 'older' } },
        boundary('work', 'clock_out', 8),
      ],
    }),
  ).toMatchObject({ success: false, error: 'time_correction_stale_source' });
  expect(
    proposeCalendarCorrection({
      contexts,
      boundaries: [boundary('work', 'clock_in', 7), boundary('work', 'clock_out', 8)],
    }),
  ).toMatchObject({ success: false });
  expect(proposeCalendarCorrection({ contexts, boundaries: [start, start] })).toMatchObject({
    success: false,
  });
  expect(proposeCalendarCorrection({ contexts: [contextFor('work', 6, null)], boundaries })).toMatchObject({
    success: false,
  });
});

test('sorting sources for locking does not change chronological proposal order', () => {
  const result = proposeCalendarCorrection({
    contexts: [contextFor('later', 8, 10), contextFor('earlier', 6, 8)],
    boundaries: [
      boundary('earlier', 'clock_in', 6),
      boundary('earlier', 'clock_out', 8),
      boundary('later', 'clock_in', 8),
      boundary('later', 'clock_out', 10),
    ],
  });
  if (!result.success) throw new Error(result.error);
  expect(result.before.facts.map((fact) => fact.timestamp)).toEqual([
    dateAt(6),
    dateAt(8),
    dateAt(8),
    dateAt(10),
  ]);
  expect(result.before.facts.map((fact) => fact.entryType)).toEqual([
    'clock_in',
    'clock_out',
    'clock_in',
    'clock_out',
  ]);
});

test('approved reload preserves adjacent interval order even when source IDs sort in reverse', () => {
  const contexts = [contextFor('00000000', 8, 10), contextFor('ffffffff', 6, 8)];
  const result = proposeCalendarCorrection({
    contexts,
    boundaries: [
      boundary('ffffffff', 'clock_in', 6),
      boundary('ffffffff', 'clock_out', 8),
      boundary('00000000', 'clock_in', 8),
      boundary('00000000', 'clock_out', 10),
    ],
  });
  if (!result.success) throw new Error(result.error);
  const entries = applyApprovedTimeCorrections(
    [],
    [
      {
        applicationId: 'application',
        requestId: 'request',
        appliedAt: version,
        appliedBy: 'reviewer',
        sourceFingerprint: 'fingerprint',
        snapshot: result.snapshot,
        sources: contexts.map((context) => context.source),
      },
    ],
    'org',
  );
  const intervals = buildLegacyIntervals(entries, 'target');
  expect(intervals.map((interval) => [interval.startedAt, interval.endedAt])).toEqual([
    [dateAt(7), dateAt(9)],
    [dateAt(9), dateAt(11)],
  ]);
});

test('travel and standby accounting context survives correction and approved reload', () => {
  for (const selection of [
    {
      kind: 'travel',
      allocationKind: 'unallocated',
      jobId: null,
      travelRoute: 'site_to_site',
      travelRole: 'driver',
    },
    { kind: 'standby', allocationKind: 'none', standbyContext: 'on_site' },
  ] as const) {
    const original = contextFor('source', 6, 8);
    const segment: TimeSegmentFact = {
      id: 'source',
      sessionId: 'session',
      organizationId: 'org',
      employeeRecordId: 'person',
      startedAt: dateAt(6),
      endedAt: dateAt(8),
      ...selection,
    };
    const context = {
      ...original,
      segment,
      snapshot: {
        ...original.snapshot,
        facts: original.snapshot.facts.map((fact) => ({
          ...fact,
          activityKind: selection.kind,
          jobId: null,
        })),
      },
    };
    const result = proposeCalendarCorrection({
      contexts: [context],
      boundaries: [boundary('source', 'clock_in', 6), boundary('source', 'clock_out', 8)],
    });
    if (!result.success) throw new Error(result.error);
    const entries = applyApprovedTimeCorrections(
      [],
      [
        {
          applicationId: 'application',
          requestId: 'request',
          appliedAt: version,
          appliedBy: 'reviewer',
          sourceFingerprint: 'fingerprint',
          snapshot: result.snapshot,
          sources: [context.source],
        },
      ],
      'org',
    );
    const interval = buildLegacyIntervals(entries, 'target')[0];
    expect(interval?.activityKind).toBe(selection.kind);
    if (selection.kind === 'travel')
      expect(interval).toMatchObject({
        travelRoute: 'site_to_site',
        travelRole: 'driver',
        allocationKind: 'unallocated',
      });
    else expect(interval).toMatchObject({ standbyContext: 'on_site', allocationKind: 'none' });
  }
});

test('a later ordinary reallocation updates the account allocation with its job', () => {
  const original = contextFor('source', 6, 8);
  const result = proposeCalendarCorrection({
    contexts: [original],
    boundaries: [boundary('source', 'clock_in', 6), boundary('source', 'clock_out', 8)],
  });
  if (!result.success) throw new Error(result.error);
  const first = result.snapshot.facts[0];
  if (!first) throw new Error('Missing first fact');
  for (const jobId of [null, 'new-job']) {
    const snapshot = mergeCorrectionProposal('reallocate', result.snapshot, {
      schemaVersion: 1,
      facts: [{ ...first, jobId }],
    });
    if (!snapshot) throw new Error('Expected reallocation');
    const entries = applyApprovedTimeCorrections(
      [],
      [
        {
          applicationId: 'application',
          requestId: 'request',
          appliedAt: version,
          appliedBy: 'reviewer',
          sourceFingerprint: 'fingerprint',
          snapshot,
          sources: [original.source],
        },
      ],
      'org',
    );
    expect(buildLegacyIntervals(entries, 'target')[0]).toMatchObject({
      allocationKind: jobId ? 'job' : 'unallocated',
      jobId: jobId ?? undefined,
    });
  }
  expect(
    mergeCorrectionProposal('reclassify', result.snapshot, {
      schemaVersion: 1,
      facts: [{ ...first, activityKind: 'travel' }],
    }),
  ).toBeNull();
});
