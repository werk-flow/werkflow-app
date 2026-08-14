import { describe, expect, test } from 'bun:test';

import { formatCommitmentWindow, isCommitmentMismatch } from './types';

describe('customer commitment mismatch', () => {
  test('the plan matching the committed day and window is no mismatch', () => {
    expect(
      isCommitmentMismatch(
        {
          committedDate: '2026-09-07',
          windowStartTime: '08:00:00',
          windowEndTime: '12:00:00',
        },
        {
          timeKind: 'timed',
          localStartDate: '2026-09-07',
          localStartTime: '09:30',
        }
      )
    ).toBe(false);
  });

  test('moving to another day mismatches — the commitment is never rewritten', () => {
    expect(
      isCommitmentMismatch(
        { committedDate: '2026-09-07', windowStartTime: null, windowEndTime: null },
        { timeKind: 'timed', localStartDate: '2026-09-08', localStartTime: '09:00' }
      )
    ).toBe(true);
  });

  test('window bounds are inclusive; an early arrival mismatches', () => {
    const window = {
      committedDate: '2026-09-07',
      windowStartTime: '08:00:00',
      windowEndTime: '10:00:00',
    };
    expect(
      isCommitmentMismatch(window, {
        timeKind: 'timed',
        localStartDate: '2026-09-07',
        localStartTime: '07:30',
      })
    ).toBe(true);
    expect(
      isCommitmentMismatch(window, {
        timeKind: 'timed',
        localStartDate: '2026-09-07',
        localStartTime: '08:00',
      })
    ).toBe(false);
    expect(
      isCommitmentMismatch(window, {
        timeKind: 'timed',
        localStartDate: '2026-09-07',
        localStartTime: '10:00',
      })
    ).toBe(false);
  });

  test('a timed start outside the committed window mismatches', () => {
    expect(
      isCommitmentMismatch(
        {
          committedDate: '2026-09-07',
          windowStartTime: '08:00:00',
          windowEndTime: '10:00:00',
        },
        {
          timeKind: 'timed',
          localStartDate: '2026-09-07',
          localStartTime: '10:30',
        }
      )
    ).toBe(true);
  });

  test('an all-day plan on the committed day satisfies a windowed commitment', () => {
    expect(
      isCommitmentMismatch(
        {
          committedDate: '2026-09-07',
          windowStartTime: '08:00:00',
          windowEndTime: '10:00:00',
        },
        { timeKind: 'all_day', localStartDate: '2026-09-07', localStartTime: null }
      )
    ).toBe(false);
  });

  test('window display text is German and unambiguous', () => {
    expect(
      formatCommitmentWindow({
        committedDate: '2026-09-07',
        windowStartTime: '08:00:00',
        windowEndTime: '12:00:00',
      })
    ).toBe('07.09.2026, 08:00–12:00 Uhr');
    expect(
      formatCommitmentWindow({
        committedDate: '2026-09-07',
        windowStartTime: null,
        windowEndTime: null,
      })
    ).toBe('07.09.2026');
  });
});
