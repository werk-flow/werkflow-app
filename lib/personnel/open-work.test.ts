import { describe, expect, test } from 'bun:test';

import {
  defaultHandoverFrom,
  handOverWorkInputSchema,
  openWorkCounts,
  orderOpenWork,
  visitsFrom,
  type OpenWorkJob,
} from './open-work';

const job = (jobId: string, label: string, visits: OpenWorkJob['visits'], parked = false): OpenWorkJob => ({
  jobId,
  label,
  parked,
  visits,
});
const visit = (occurrenceId: string, date: string, time: string | null = null) => ({
  occurrenceId,
  date,
  time,
});

describe('a person’s open work', () => {
  test('lists jobs with an upcoming visit first, by their next visit, then the rest by name', () => {
    const ordered = orderOpenWork([
      job('parked', 'Zählertausch', [], true),
      job('later', 'Badsanierung', [visit('b2', '2026-12-03'), visit('b1', '2026-11-20', '07:00')]),
      job('none', 'Angebot', []),
      job('sooner', 'Wartung', [visit('w1', '2026-11-20', '06:30')]),
    ]);
    expect(ordered.map((entry) => entry.jobId)).toEqual(['sooner', 'later', 'none', 'parked']);
    expect(ordered[1]?.visits.map((entry) => entry.occurrenceId)).toEqual(['b1', 'b2']);
  });

  test('a handover moves the visits from its date on and leaves the earlier ones', () => {
    const work = job('j', 'Wartung', [
      visit('a', '2026-11-30'),
      visit('b', '2026-12-01'),
      visit('c', '2026-12-02'),
    ]);
    expect(visitsFrom(work, '2026-12-01').map((entry) => entry.occurrenceId)).toEqual(['b', 'c']);
  });

  test('counts the open jobs the way the member page splits them, parked ones apart', () => {
    expect(openWorkCounts([job('a', 'A', []), job('b', 'B', [], true), job('c', 'C', [])])).toEqual({
      total: 3,
      parked: 1,
    });
  });
});

describe('the default handover date', () => {
  const today = '2026-11-09';

  test('is the day after the exit date', () => {
    expect(defaultHandoverFrom({ exitDate: '2026-11-30', accessEndDate: null, today })).toBe('2026-12-01');
  });

  test('is the access end when it comes before the exit', () => {
    expect(defaultHandoverFrom({ exitDate: '2026-11-30', accessEndDate: '2026-11-20', today })).toBe(
      '2026-11-20',
    );
  });

  test('is today without an exit, and never in the past', () => {
    expect(defaultHandoverFrom({ exitDate: null, accessEndDate: null, today })).toBe(today);
    expect(defaultHandoverFrom({ exitDate: '2026-10-31', accessEndDate: null, today })).toBe(today);
  });
});

describe('the handover input', () => {
  const base = {
    employeeRecordId: '86000000-0000-4000-8000-000000000001',
    handoverFrom: '2026-12-01',
    rows: [
      {
        jobId: '86000000-0000-4000-8000-000000000011',
        targetEmployeeRecordId: '86000000-0000-4000-8000-000000000002',
      },
    ],
  };

  test('accepts one target per job', () => {
    expect(handOverWorkInputSchema.safeParse(base).success).toBe(true);
  });

  test('refuses no job, a job twice and a short reason', () => {
    expect(handOverWorkInputSchema.safeParse({ ...base, rows: [] }).success).toBe(false);
    expect(handOverWorkInputSchema.safeParse({ ...base, rows: [...base.rows, ...base.rows] }).success).toBe(
      false,
    );
    expect(
      handOverWorkInputSchema.safeParse({ ...base, planningApproval: { fingerprint: 'f', reason: 'kurz' } })
        .success,
    ).toBe(false);
  });
});
