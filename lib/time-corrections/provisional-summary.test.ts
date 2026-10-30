import { describe, expect, test } from 'bun:test';
import { summarizePendingCorrections } from './provisional-summary';
import type { TimeCorrectionFact, TimeCorrectionSnapshot } from './types';

function fact(entryType: TimeCorrectionFact['entryType'], timestamp: string): TimeCorrectionFact {
  return {
    factId: `${entryType}-${timestamp}`,
    employeeRecordId: 'employee',
    userId: 'user',
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
    const summary = summarizePendingCorrections([
      // 27.10. in Berlin: 06:00 to 14:30 local.
      request(
        snapshot(),
        snapshot(fact('clock_in', '2026-10-27T05:00:00.000Z'), fact('clock_out', '2026-10-27T13:30:00.000Z')),
      ),
      // 26.10. in Berlin, although 23:30 UTC of the 25th.
      request(
        snapshot(fact('clock_in', '2026-10-25T23:30:00.000Z'), fact('clock_out', '2026-10-26T07:00:00.000Z')),
        snapshot(fact('clock_in', '2026-10-25T23:30:00.000Z'), fact('clock_out', '2026-10-26T08:00:00.000Z')),
      ),
    ]);
    expect(summary).toEqual({
      count: 2,
      beforeMinutes: 450,
      proposedMinutes: 510 + 510,
      days: ['2026-10-26', '2026-10-27'],
    });
  });
});
