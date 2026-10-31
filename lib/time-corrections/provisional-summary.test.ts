import { describe, expect, test } from 'bun:test';
import { summarizePendingCorrections } from './provisional-summary';
import type { TimeCorrectionFact, TimeCorrectionSnapshot } from './types';

function fact(
  entryType: TimeCorrectionFact['entryType'],
  timestamp: string,
  userId = 'user',
): TimeCorrectionFact {
  return {
    factId: `${entryType}-${timestamp}-${userId}`,
    employeeRecordId: 'employee',
    userId,
    entryType,
    timestamp,
    jobId: null,
    activityKind: 'work',
    isManual: true,
  };
}

const snapshot = (...facts: TimeCorrectionFact[]): TimeCorrectionSnapshot => ({ schemaVersion: 1, facts });

function request(beforeSnapshot: TimeCorrectionSnapshot, proposedSnapshot: TimeCorrectionSnapshot) {
  return {
    revision: {
      revision: 1,
      reason: 'Vergessen',
      beforeSnapshot,
      proposedSnapshot,
      createdBy: 'user',
      createdAt: '2026-10-28T08:00:00.000Z',
    },
  };
}

describe('the pending corrections in sum', () => {
  test('name the Berlin days they change, once each and in order', () => {
    const summary = summarizePendingCorrections(
      [
        // 27.10. in Berlin: 06:00 to 14:30 local.
        request(
          snapshot(),
          snapshot(
            fact('clock_in', '2026-10-27T05:00:00.000Z'),
            fact('clock_out', '2026-10-27T13:30:00.000Z'),
          ),
        ),
        // 26.10. in Berlin, although 23:30 UTC of the 25th.
        request(
          snapshot(
            fact('clock_in', '2026-10-25T23:30:00.000Z'),
            fact('clock_out', '2026-10-26T07:00:00.000Z'),
          ),
          snapshot(
            fact('clock_in', '2026-10-25T23:30:00.000Z'),
            fact('clock_out', '2026-10-26T08:00:00.000Z'),
          ),
        ),
      ],
      'user',
    );
    expect(summary).toEqual({
      count: 2,
      beforeMinutes: 450,
      proposedMinutes: 510 + 510,
      days: ['2026-10-26', '2026-10-27'],
    });
  });

  test('name the day a session ends at midnight as the day it was worked', () => {
    // 27.10. in Berlin: 18:00 to 00:00 local; the clock_out at midnight closes the 27th.
    const summary = summarizePendingCorrections(
      [
        request(
          snapshot(),
          snapshot(
            fact('clock_in', '2026-10-27T17:00:00.000Z'),
            fact('clock_out', '2026-10-27T23:00:00.000Z'),
          ),
        ),
      ],
      'user',
    );
    expect(summary.days).toEqual(['2026-10-27']);
  });

  test('name every day an unsplit interval spans, not only the days of its facts', () => {
    // A legacy approved interval from 26.10. 22:00 to 28.10. 02:00 local, shortened to end on the 26th.
    const summary = summarizePendingCorrections(
      [
        request(
          snapshot(
            fact('clock_in', '2026-10-26T21:00:00.000Z'),
            fact('clock_out', '2026-10-28T01:00:00.000Z'),
          ),
          snapshot(
            fact('clock_in', '2026-10-26T21:00:00.000Z'),
            fact('clock_out', '2026-10-26T22:30:00.000Z'),
          ),
        ),
      ],
      'user',
    );
    expect(summary.days).toEqual(['2026-10-26', '2026-10-27', '2026-10-28']);
  });

  test('count only the facts of the subject of a reassignment', () => {
    // A works 09:00 to 12:00 local on 26.10.; B's 10:00 to 11:00 sits inside it.
    const before = snapshot(
      fact('clock_in', '2026-10-26T08:00:00.000Z', 'a'),
      fact('clock_in', '2026-10-26T09:00:00.000Z', 'b'),
      fact('clock_out', '2026-10-26T10:00:00.000Z', 'b'),
      fact('clock_out', '2026-10-26T11:00:00.000Z', 'a'),
    );
    expect(summarizePendingCorrections([request(before, snapshot())], 'a').beforeMinutes).toBe(180);
    expect(summarizePendingCorrections([request(before, snapshot())], 'b').beforeMinutes).toBe(60);

    // A's interval from 26.10. to 30.10. spans B's interval on the 28th: A's days run through.
    const spanning = snapshot(
      fact('clock_in', '2026-10-26T08:00:00.000Z', 'a'),
      fact('clock_in', '2026-10-28T08:00:00.000Z', 'b'),
      fact('clock_out', '2026-10-28T09:00:00.000Z', 'b'),
      fact('clock_out', '2026-10-30T08:00:00.000Z', 'a'),
    );
    expect(summarizePendingCorrections([request(spanning, snapshot())], 'a').days).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
    ]);
    expect(summarizePendingCorrections([request(spanning, snapshot())], 'b').days).toEqual(['2026-10-28']);
  });
});
