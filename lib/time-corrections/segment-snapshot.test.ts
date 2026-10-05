import { expect, test } from 'bun:test';
import {
  createActivitySelection,
  projectTimeSegmentsToLegacyTransitions,
  type TimeSegmentFact,
} from '@/lib/time-tracking/segments';
import { createSegmentCorrectionSnapshot } from './segment-snapshot';
import { mergeCorrectionProposal } from './merge-proposal';
import { correctionFactToEntry, type TimeCorrectionApplicationProjection } from './types';
import { validateCorrectionTimeline } from './timeline-validation';

test('editing resumed work preserves the real break-end transition and the surrounding session', () => {
  const times = ['06:00', '10:00', '10:30', '15:00'];
  const session = (['work', 'break', 'work'] as const).map(
    (kind, index): TimeSegmentFact => ({
      ...createActivitySelection(kind),
      id: `segment-${index}`,
      sessionId: 'session',
      organizationId: 'org',
      employeeRecordId: 'person',
      startedAt: `2026-09-08T${times[index]}:00.000Z`,
      endedAt: `2026-09-08T${times[index + 1]}:00.000Z`,
    }),
  );
  const resumed = session[2];
  if (!resumed) throw new Error('Missing resumed work fixture.');
  const before = createSegmentCorrectionSnapshot(resumed, session, 'user');
  expect(before.facts.map((fact) => fact.entryType)).toEqual(['break_end', 'clock_out']);
  const closing = before.facts[1];
  if (!closing) throw new Error('Missing closing fixture.');
  const proposed = mergeCorrectionProposal('edit', before, {
    schemaVersion: 1,
    facts: [{ ...closing, timestamp: '2026-09-08T15:15:00.000Z' }],
  });
  if (!proposed) throw new Error('Expected an editable source.');
  const application: TimeCorrectionApplicationProjection = {
    applicationId: 'candidate',
    requestId: 'request',
    appliedAt: '2026-09-09T00:00:00Z',
    appliedBy: 'admin',
    sourceFingerprint: 'version',
    sources: [{ kind: 'canonical_segment', id: resumed.id, version: 'version' }],
    snapshot: proposed,
  };
  const entries = projectTimeSegmentsToLegacyTransitions(
    session,
    new Date('2026-09-08'),
    new Date('2026-09-09'),
  ).map((point, index) => ({
    ...correctionFactToEntry(
      { ...closing, factId: String(index), entryType: point.entryType, timestamp: point.timestamp },
      application,
    ),
    canonicalSegmentId: point.segmentId,
  }));
  expect(
    validateCorrectionTimeline({
      organizationId: 'org',
      affectedDays: new Set(['user:2026-09-08']),
      entries,
      applications: [],
      candidates: [application],
    }),
  ).toBe(true);
  const wrongOpening = {
    ...proposed,
    facts: proposed.facts.map((fact) =>
      fact.entryType === 'break_end' ? { ...fact, entryType: 'clock_in' as const } : fact,
    ),
  };
  expect(
    validateCorrectionTimeline({
      organizationId: 'org',
      affectedDays: new Set(['user:2026-09-08']),
      entries,
      applications: [],
      candidates: [{ ...application, snapshot: wrongOpening }],
    }),
  ).toBe(false);
});
