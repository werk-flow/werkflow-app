import { describe, expect, test } from 'bun:test';
import { buildLegacyIntervals } from '@/lib/time-accounts/legacy-intervals';
import {
  createActivitySelection,
  projectTimeSegmentsToLegacyTransitions,
  type TimeSegmentFact,
} from '@/lib/time-tracking/segments';
import type { TimeActivitySelection } from '@/lib/time-tracking/types';
import { mergeCorrectionProposal } from './merge-proposal';
import { applyApprovedTimeCorrections } from './projection';
import { createSegmentCorrectionSnapshot } from './segment-snapshot';
import { exceedsLongestOpenTime, splitCorrectionFactsAtMidnight } from './timeline-validation';
import {
  correctionFactToEntry,
  type TimeCorrectionApplicationProjection,
  type TimeCorrectionFact,
  type TimeCorrectionSnapshot,
} from './types';

// A shift of 9 h (07:00 to 16:00 Berlin) that the person never ended on the
// clock; recovery ended it two days later at 16:30 Berlin.
const recovered: TimeSegmentFact = {
  ...createActivitySelection('work'),
  id: 'segment',
  sessionId: 'session',
  organizationId: 'org',
  employeeRecordId: 'person',
  startedAt: '2026-09-07T05:00:00.000Z',
  endedAt: '2026-09-09T14:30:00.000Z',
};
const realStart = '2026-09-07T05:00:00.000Z';
const realEnd = '2026-09-07T14:00:00.000Z';
const NINE_HOURS = 9 * 60;
const before = createSegmentCorrectionSnapshot(recovered, [recovered], 'user');
const template: TimeCorrectionFact = (() => {
  const [first] = before.facts;
  if (!first) throw new Error('Missing source fact fixture.');
  return first;
})();

function proposed(...facts: Array<['clock_in' | 'clock_out', string]>): TimeCorrectionSnapshot {
  return {
    schemaVersion: 1,
    facts: facts.map(([entryType, timestamp]) => ({ ...template, factId: entryType, entryType, timestamp })),
  };
}

/** What the office approves: the merged proposal, split at midnight as submission stores it. */
function approve(proposal: TimeCorrectionSnapshot | null): TimeCorrectionApplicationProjection {
  if (!proposal) throw new Error('Expected an editable source.');
  expect(exceedsLongestOpenTime(proposal.facts)).toBe(false);
  return {
    applicationId: 'application',
    requestId: 'request',
    appliedAt: '2026-09-10T08:00:00.000Z',
    appliedBy: 'office',
    sourceFingerprint: 'version',
    sources: [{ kind: 'canonical_segment', id: recovered.id, version: 'version' }],
    snapshot: { ...proposal, facts: splitCorrectionFactsAtMidnight(proposal.facts) },
  };
}

/** The minutes the time account counts once the correction is approved. */
function countedMinutes(application: TimeCorrectionApplicationProjection): number {
  const raw = projectTimeSegmentsToLegacyTransitions(
    [recovered],
    new Date('2026-09-06T00:00:00.000Z'),
    new Date('2026-09-11T00:00:00.000Z'),
  ).map((point, index) => ({
    ...correctionFactToEntry(
      { ...template, factId: String(index), entryType: point.entryType, timestamp: point.timestamp },
      { ...application, applicationId: 'raw' },
    ),
    id: `raw-${index}`,
    correctionApplicationId: undefined,
    canonicalSegmentId: point.segmentId,
  }));
  const intervals = buildLegacyIntervals(applyApprovedTimeCorrections(raw, [application], 'org'), 'person');
  return intervals.reduce(
    (minutes, interval) => minutes + (Date.parse(interval.endedAt) - Date.parse(interval.startedAt)) / 60_000,
    0,
  );
}

describe('an edit of a recovery-ended segment that spans several days', () => {
  test('the uncorrected source counts every day up to the recovery end', () => {
    expect(before.facts.map((fact) => fact.entryType)).toEqual([
      'clock_in',
      'clock_out',
      'clock_in',
      'clock_out',
      'clock_in',
      'clock_out',
    ]);
    expect(countedMinutes(approve(before))).toBe(57.5 * 60);
  });

  test('a whole clock_in/clock_out pair replaces the source and counts only its span', () => {
    const proposal = mergeCorrectionProposal(
      'edit',
      before,
      proposed(['clock_in', realStart], ['clock_out', realEnd]),
    );
    expect(proposal?.facts.map((fact) => [fact.entryType, fact.timestamp])).toEqual([
      ['clock_in', realStart],
      ['clock_out', realEnd],
    ]);
    expect(countedMinutes(approve(proposal))).toBe(NINE_HOURS);
  });

  test('a new end alone ends the segment there and drops the later days', () => {
    const proposal = mergeCorrectionProposal('edit', before, proposed(['clock_out', realEnd]));
    expect(countedMinutes(approve(proposal))).toBe(NINE_HOURS);
  });

  test('a new start alone keeps every day up to the recovery end', () => {
    const proposal = mergeCorrectionProposal(
      'edit',
      before,
      proposed(['clock_in', '2026-09-07T06:00:00.000Z']),
    );
    expect(countedMinutes(approve(proposal))).toBe(56.5 * 60);
  });

  test('a later new end replaces the close instead of adding a second one', () => {
    const laterEnd = '2026-09-09T15:00:00.000Z';
    const proposal = mergeCorrectionProposal('edit', before, proposed(['clock_out', laterEnd]));
    const closes = proposal?.facts.filter((fact) => fact.entryType === 'clock_out') ?? [];
    expect(proposal?.facts.at(-1)?.timestamp).toBe(laterEnd);
    expect(
      closes.filter((fact) => Date.parse(fact.timestamp) > Date.parse(recovered.endedAt ?? '')),
    ).toHaveLength(1);
    expect(closes.some((fact) => fact.timestamp === recovered.endedAt)).toBe(false);
    expect(countedMinutes(approve(proposal))).toBe(58 * 60);
  });

  test('a pair edit keeps a source whose pieces differ in a qualifier', () => {
    const travel = (travelRole: 'driver' | 'passenger'): TimeActivitySelection => ({
      kind: 'travel',
      allocationKind: 'unallocated',
      jobId: null,
      travelRoute: 'company_to_site',
      travelRole,
    });
    const [firstIn, firstOut, secondIn, secondOut] = before.facts;
    if (!firstIn || !firstOut || !secondIn || !secondOut) throw new Error('Missing source fact fixture.');
    const mixed: TimeCorrectionSnapshot = {
      schemaVersion: 1,
      facts: [
        { ...firstIn, activityKind: 'travel', activity: travel('driver') },
        { ...firstOut, activityKind: 'travel', activity: travel('driver') },
        { ...secondIn, activityKind: 'travel', activity: travel('passenger') },
        { ...secondOut, activityKind: 'travel', activity: travel('passenger') },
      ],
    };
    const proposal = mergeCorrectionProposal(
      'edit',
      mixed,
      proposed(['clock_in', realStart], ['clock_out', realEnd]),
    );
    expect(proposal?.facts).toHaveLength(4);
    expect(proposal?.facts.map((fact) => fact.activity)).toEqual(mixed.facts.map((fact) => fact.activity));
  });

  test('a new end on a daytime switch keeps the later piece (07:00-12:00 and 12:00-16:00 Berlin)', () => {
    const [firstIn, firstOut, secondIn, secondOut] = before.facts;
    if (!firstIn || !firstOut || !secondIn || !secondOut) throw new Error('Missing source fact fixture.');
    const daytime: TimeCorrectionSnapshot = {
      schemaVersion: 1,
      facts: [
        { ...firstIn, timestamp: '2026-09-07T05:00:00.000Z' },
        { ...firstOut, timestamp: '2026-09-07T10:00:00.000Z' },
        { ...secondIn, timestamp: '2026-09-07T10:00:00.000Z' },
        { ...secondOut, timestamp: '2026-09-07T14:00:00.000Z' },
      ],
    };
    const proposal = mergeCorrectionProposal(
      'edit',
      daytime,
      proposed(['clock_out', '2026-09-07T09:00:00.000Z']),
    );
    expect(proposal?.facts.map((fact) => [fact.entryType, fact.timestamp])).toEqual([
      ['clock_in', '2026-09-07T05:00:00.000Z'],
      ['clock_out', '2026-09-07T09:00:00.000Z'],
      ['clock_in', '2026-09-07T10:00:00.000Z'],
      ['clock_out', '2026-09-07T14:00:00.000Z'],
    ]);
  });

  test('a new end keeps the later pieces when a daytime join sits before a midnight split', () => {
    const [firstIn, firstOut, secondIn, secondOut, thirdIn, thirdOut] = before.facts;
    if (!firstIn || !firstOut || !secondIn || !secondOut || !thirdIn || !thirdOut)
      throw new Error('Missing source fact fixture.');
    // 07:00-12:00, 12:00-24:00 and 00:00-16:00 Berlin: one daytime join, then midnight.
    const mixed: TimeCorrectionSnapshot = {
      schemaVersion: 1,
      facts: [
        { ...firstIn, timestamp: '2026-09-07T05:00:00.000Z' },
        { ...firstOut, timestamp: '2026-09-07T10:00:00.000Z' },
        { ...secondIn, timestamp: '2026-09-07T10:00:00.000Z' },
        { ...secondOut, timestamp: '2026-09-07T22:00:00.000Z' },
        { ...thirdIn, timestamp: '2026-09-07T22:00:00.000Z' },
        { ...thirdOut, timestamp: '2026-09-08T14:00:00.000Z' },
      ],
    };
    const proposal = mergeCorrectionProposal(
      'edit',
      mixed,
      proposed(['clock_out', '2026-09-07T09:00:00.000Z']),
    );
    expect(proposal?.facts.map((fact) => fact.timestamp)).toEqual([
      '2026-09-07T05:00:00.000Z',
      '2026-09-07T09:00:00.000Z',
      '2026-09-07T10:00:00.000Z',
      '2026-09-07T22:00:00.000Z',
      '2026-09-07T22:00:00.000Z',
      '2026-09-08T14:00:00.000Z',
    ]);
  });
});
