import { describe, expect, test } from 'bun:test';

import { CLOCKED_OUT, SESSION_ID, WORKER, WORKING } from '@/lib/testing/fixtures/time-outbox';
import type { TimeEntry } from '@/lib/time-tracking/types';
import type { ClockDeviceView } from './time-outbox';
import { replacedSegmentEnd, replacementWindow, sessionReplacement } from './time-outbox-replacement';

// A late chain of a session the server holds or held is settled by one correction that replaces the
// session's recorded end with the captured one (decision record 0010, "a late chain of a session that
// still runs"). Which chains offer it, and which recorded entry it edits.

const SEGMENT = '60000000-0000-4000-8000-000000000001';
const EARLIER_SEGMENT = '60000000-0000-4000-8000-000000000002';
/** A segment of another session, which another device started before the chain began. */
const OTHER_SESSION_SEGMENT = '60000000-0000-4000-8000-000000000003';

/**
 * A stopped chain of `actions`, six hours apart and ending at 15:00 UTC, the first expecting `sessionId`,
 * captured while the kept clock showed `chainSegmentId` running.
 */
function stoppedChain(
  actions: Array<'start' | 'switch' | 'end'>,
  sessionId: string | null,
  chainSegmentId: string | null = SEGMENT,
): ClockDeviceView {
  return {
    status: 'stopped',
    state: null,
    chainSegmentId,
    setAside: [],
    events: actions.map((action, index) => ({
      operationId: `50000000-0000-4000-8000-0000000000c${index}`,
      // Six hours apart, the last at 15:00 UTC.
      capturedAt: `2026-11-09T${String(15 - (actions.length - 1 - index) * 6).padStart(2, '0')}:00:00.000Z`,
      action,
      selection: action === 'end' ? null : { kind: 'break', allocationKind: 'none' },
      expected: index === 0 ? { sessionId, version: sessionId ? 3 : null } : null,
      status: index === 0 ? 'correction' : 'held',
      code: index === 0 ? 'correction_required' : null,
    })),
  };
}

function entry(
  segmentId: string,
  entryType: TimeEntry['entryType'],
  timestamp: string,
  sourceKind: TimeEntry['sourceKind'] = 'canonical_segment',
): TimeEntry {
  return {
    id: `${segmentId}:${timestamp}:${entryType}`,
    userId: WORKER.userId,
    organizationId: WORKER.organizationId,
    entryType,
    timestamp,
    isManual: false,
    jobId: null,
    status: 'approved',
    reviewedBy: null,
    reviewedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    sourceKind,
    canonicalSegmentId: segmentId,
  };
}

describe('the replacement a stopped chain offers', () => {
  test('covers a chain whose first event expects a session and whose first day ends it', () => {
    const replacement = sessionReplacement(stoppedChain(['end'], SESSION_ID), WORKING);
    expect(replacement).toMatchObject({
      sessionId: SESSION_ID,
      segmentId: SEGMENT,
      capturedEnd: '2026-11-09T15:00:00.000Z',
    });
    expect(replacement?.events.map((event) => event.action)).toEqual(['end']);
  });

  test('is offered as well once the session no longer runs, so a flow interrupted after the end goes on', () => {
    expect(sessionReplacement(stoppedChain(['end'], SESSION_ID), CLOCKED_OUT)).not.toBeNull();
  });

  test('is not offered for a chain with a switch before its end: one edit of the end would drop the break it records', () => {
    // Pause 09:00 UTC, end 15:00 UTC: an edit of the recorded end alone counts the break as work.
    expect(sessionReplacement(stoppedChain(['switch', 'end'], SESSION_ID), WORKING)).toBeNull();
  });

  test('is not offered for a chain that starts its own session: that is an addition', () => {
    expect(sessionReplacement(stoppedChain(['start', 'end'], null), CLOCKED_OUT)).toBeNull();
  });

  test('is not offered without a captured end: the phone does not know what replaces the server’s end', () => {
    expect(sessionReplacement(stoppedChain(['switch'], SESSION_ID), WORKING)).toBeNull();
  });

  test('is not offered for a conflict or a refusal: only a chain too late to be recorded by itself', () => {
    const chain = stoppedChain(['end'], SESSION_ID);
    for (const status of ['conflict', 'failed'] as const) {
      const [head, ...rest] = chain.events;
      if (!head) throw new Error('Missing head fixture.');
      expect(sessionReplacement({ ...chain, events: [{ ...head, status }, ...rest] }, WORKING)).toBeNull();
    }
  });

  test('is not offered when the phone does not know which segment ran when the chain began', () => {
    expect(sessionReplacement(stoppedChain(['end'], SESSION_ID, null), WORKING)).toBeNull();
  });

  test('is not offered while the server’s clock is unknown', () => {
    expect(sessionReplacement(stoppedChain(['end'], SESSION_ID), null)).toBeNull();
  });

  test('reads the session’s entries from the start of the chain’s Berlin day', () => {
    const replacement = sessionReplacement(stoppedChain(['end'], SESSION_ID), WORKING);
    if (!replacement) throw new Error('Expected a replacement.');
    expect(replacementWindow(replacement, new Date('2026-11-10T12:00:00.000Z'))).toEqual({
      from: '2026-11-08T23:00:00.000Z',
      to: '2026-11-10T12:00:00.000Z',
    });
  });
});

describe('the entry the replacement edits', () => {
  const replacement = sessionReplacement(stoppedChain(['end'], SESSION_ID), WORKING);
  if (!replacement) throw new Error('Expected a replacement.');
  // Clock-in 07:00 UTC with signal, ended through the clock the next day at 10:00 UTC.
  const recovered = [
    entry(SEGMENT, 'clock_in', '2026-11-09T07:00:00.000Z'),
    entry(SEGMENT, 'clock_out', '2026-11-09T23:00:00.000Z'),
    entry(SEGMENT, 'clock_in', '2026-11-09T23:00:00.000Z'),
    entry(SEGMENT, 'clock_out', '2026-11-10T10:00:00.000Z'),
  ];

  test('is the last end of the segment that ran from the chain’s start past its captured end, at the captured time', () => {
    expect(replacedSegmentEnd(recovered, replacement)).toMatchObject({
      canonicalSegmentId: SEGMENT,
      entryType: 'clock_out',
      sourceKind: 'canonical_segment',
      id: `${SEGMENT}:2026-11-10T10:00:00.000Z:clock_out`,
      timestamp: '2026-11-09T15:00:00.000Z',
    });
  });

  test('ignores a segment that ended before the chain began', () => {
    const earlier = [
      entry(EARLIER_SEGMENT, 'clock_in', '2026-11-09T05:00:00.000Z'),
      entry(EARLIER_SEGMENT, 'clock_out', '2026-11-09T06:00:00.000Z'),
    ];
    expect(replacedSegmentEnd([...earlier, ...recovered], replacement)?.canonicalSegmentId).toBe(SEGMENT);
  });

  test('is never another session’s segment, even one that ran from the chain’s start past its captured end', () => {
    // Another device ended the expected session at 08:00 and started another at 08:30.
    const otherSession = [
      entry(SEGMENT, 'clock_in', '2026-11-09T07:00:00.000Z'),
      entry(SEGMENT, 'clock_out', '2026-11-09T08:00:00.000Z'),
      entry(OTHER_SESSION_SEGMENT, 'clock_in', '2026-11-09T08:30:00.000Z'),
      entry(OTHER_SESSION_SEGMENT, 'clock_out', '2026-11-09T17:00:00.000Z'),
    ];
    expect(replacedSegmentEnd(otherSession, replacement)).toBeNull();
  });

  test('is missing when the session ended before the captured end: nothing recorded runs past it', () => {
    const endedEarly = [
      entry(SEGMENT, 'clock_in', '2026-11-09T07:00:00.000Z'),
      entry(SEGMENT, 'clock_out', '2026-11-09T12:00:00.000Z'),
    ];
    expect(replacedSegmentEnd(endedEarly, replacement)).toBeNull();
  });

  test('is missing once a correction replaced the segment', () => {
    const corrected = recovered.map((piece) => ({ ...piece, sourceKind: 'correction_application' as const }));
    expect(replacedSegmentEnd(corrected, replacement)).toBeNull();
  });
});
