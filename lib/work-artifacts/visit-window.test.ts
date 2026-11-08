import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';

import type { TimeEntry } from '@/lib/time-tracking/types';
import { recordedVisitWindow } from './visit-window';

const jobId = 'job-heizung';
const userId = 'worker-anna';

function entry(
  id: string,
  entryType: TimeEntry['entryType'],
  timestamp: string,
  overrides: Partial<TimeEntry> = {},
): TimeEntry {
  return {
    id,
    userId,
    organizationId: 'org',
    entryType,
    timestamp,
    isManual: false,
    jobId,
    status: 'approved',
    reviewedBy: null,
    reviewedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

// 2026-11-02 in Berlin (UTC+1).
const now = new Date('2026-11-02T15:00:00+01:00');

describe('recordedVisitWindow', () => {
  // The session pairing reads the clock: an unpaired start is open only today, and a later entry does not count yet.
  beforeEach(() => setSystemTime(now));
  afterEach(() => setSystemTime());

  test('Beginn is the first start and Ende the last end of today on the job', () => {
    const entries = [
      entry('in-1', 'clock_in', '2026-11-02T07:00:00+01:00'),
      entry('break', 'break_start', '2026-11-02T09:30:00+01:00'),
      entry('back', 'break_end', '2026-11-02T10:00:00+01:00'),
      entry('out-1', 'clock_out', '2026-11-02T12:15:00+01:00'),
    ];
    expect(recordedVisitWindow(entries, { jobId, userId, now })).toEqual({
      startedAt: '2026-11-02T07:00:00+01:00',
      endedAt: '2026-11-02T12:15:00+01:00',
    });
  });

  test('an open session leaves Ende empty instead of inventing an end', () => {
    const entries = [entry('in-1', 'clock_in', '2026-11-02T07:00:00+01:00')];
    expect(recordedVisitWindow(entries, { jobId, userId, now })).toEqual({
      startedAt: '2026-11-02T07:00:00+01:00',
      endedAt: null,
    });
  });

  test("yesterday's time, another person's time and another job's time give no window", () => {
    const entries = [
      entry('yesterday-in', 'clock_in', '2026-11-01T07:00:00+01:00'),
      entry('yesterday-out', 'clock_out', '2026-11-01T15:00:00+01:00'),
      entry('colleague-in', 'clock_in', '2026-11-02T07:00:00+01:00', { userId: 'worker-ben' }),
      entry('colleague-out', 'clock_out', '2026-11-02T11:00:00+01:00', { userId: 'worker-ben' }),
      entry('other-in', 'clock_in', '2026-11-02T12:00:00+01:00', { jobId: 'job-bad' }),
      entry('other-out', 'clock_out', '2026-11-02T13:00:00+01:00', { jobId: 'job-bad' }),
    ];
    expect(recordedVisitWindow(entries, { jobId, userId, now })).toEqual({ startedAt: null, endedAt: null });
  });

  test('entries in any order give the same window', () => {
    const entries = [
      entry('out-1', 'clock_out', '2026-11-02T12:15:00+01:00'),
      entry('in-1', 'clock_in', '2026-11-02T07:00:00+01:00'),
    ];
    expect(recordedVisitWindow(entries, { jobId, userId, now }).startedAt).toBe('2026-11-02T07:00:00+01:00');
  });

  test('an open break keeps Ende empty, and a clock-out during the break is the end', () => {
    const working = [
      entry('in-1', 'clock_in', '2026-11-02T07:00:00+01:00'),
      entry('break', 'break_start', '2026-11-02T12:00:00+01:00'),
    ];
    expect(recordedVisitWindow(working, { jobId, userId, now })).toEqual({
      startedAt: '2026-11-02T07:00:00+01:00',
      endedAt: null,
    });
    const clockedOutDuringBreak = [...working, entry('out-1', 'clock_out', '2026-11-02T12:20:00+01:00')];
    expect(recordedVisitWindow(clockedOutDuringBreak, { jobId, userId, now })).toEqual({
      startedAt: '2026-11-02T07:00:00+01:00',
      endedAt: '2026-11-02T12:20:00+01:00',
    });
  });
});
