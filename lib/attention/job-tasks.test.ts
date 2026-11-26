import { describe, expect, test } from 'bun:test';

import { toOverdueJobTasks, type OverdueJobRow } from './job-tasks';

const overdue = (overrides: Partial<OverdueJobRow> = {}): OverdueJobRow => ({
  id: '0b8f6a52-1c3e-4a7d-9e21-5f4c3b2a1d02',
  job_number: 'A-1002',
  title: 'Bad sanieren',
  project_id: null,
  project_number: null,
  last_timed_end: null,
  last_all_day_end: null,
  ...overrides,
});

/** The last visit day a job past its visits names, seen long after it. */
function lastVisitDate(ends: Pick<OverdueJobRow, 'last_timed_end' | 'last_all_day_end'>): string | null {
  const [task] = toOverdueJobTasks([overdue(ends)], '2099-01-01');
  return task?.sourceType === 'job_past_last_visit' ? task.lastVisitDate : null;
}

describe('the last visit day', () => {
  // Each row: the last timed end, the last all-day end (exclusive), and the Berlin day the visits end on.
  const cases: [string, string | null, string | null, string][] = [
    ['a timed visit ends on its Berlin day', '2026-11-30T16:00:00Z', null, '2026-11-30'],
    [
      'a timed visit ending at 00:30 Berlin belongs to the next day',
      '2026-11-30T23:30:00Z',
      null,
      '2026-12-01',
    ],
    [
      'a timed visit ending at Berlin midnight ends on the day before',
      '2026-11-30T23:00:00Z',
      null,
      '2026-11-30',
    ],
    ['in summer time, Berlin midnight is 22:00 UTC', '2026-06-30T22:00:00Z', null, '2026-06-30'],
    [
      'an all-day visit ends on the day before its exclusive end, across a month end',
      null,
      '2026-12-01',
      '2026-11-30',
    ],
    ['an all-day visit ending on a leap day', null, '2028-03-01', '2028-02-29'],
    ['the later of a timed and an all-day visit counts', '2026-11-20T10:00:00Z', '2026-11-25', '2026-11-24'],
    [
      'the later timed visit counts over an earlier all-day one',
      '2026-11-27T10:00:00Z',
      '2026-11-25',
      '2026-11-27',
    ],
  ];
  for (const [name, timedEnd, allDayEnd, expected] of cases) {
    test(name, () => {
      expect(lastVisitDate({ last_timed_end: timedEnd, last_all_day_end: allDayEnd })).toBe(expected);
    });
  }

  test('a job without a scheduled visit has no last visit', () => {
    expect(lastVisitDate({ last_timed_end: null, last_all_day_end: null })).toBeNull();
  });
});

describe('toOverdueJobTasks', () => {
  test("a job of a project links to the job's page inside its project", () => {
    const [task] = toOverdueJobTasks(
      [
        overdue({
          project_id: '0b8f6a52-1c3e-4a7d-9e21-5f4c3b2a1d09',
          project_number: 'P-7',
          last_timed_end: '2026-11-10T10:00:00Z',
        }),
      ],
      '2026-11-17',
    );
    expect(task).toMatchObject({
      jobLabel: 'A-1002 · Bad sanieren',
      jobHref: '/auftraege/projekt/P-7/A-1002',
    });
  });

  // Each row: the last visit's end facts, today in Berlin, and whether the job is past its last visit.
  const pastCases: [string, Pick<OverdueJobRow, 'last_timed_end' | 'last_all_day_end'>, string, boolean][] = [
    [
      'a visit that ended yesterday',
      { last_timed_end: '2026-11-16T15:00:00Z', last_all_day_end: null },
      '2026-11-17',
      true,
    ],
    [
      'a visit that ended earlier today',
      { last_timed_end: '2026-11-17T09:00:00Z', last_all_day_end: null },
      '2026-11-17',
      false,
    ],
    [
      'the last day of the month seen on the first of the next',
      { last_timed_end: '2026-11-30T22:59:00Z', last_all_day_end: null },
      '2026-12-01',
      true,
    ],
    [
      'a visit ending at 00:30 Berlin on the first, seen that day',
      { last_timed_end: '2026-11-30T23:30:00Z', last_all_day_end: null },
      '2026-12-01',
      false,
    ],
    [
      'an all-day visit through the month end, seen on the first',
      { last_timed_end: null, last_all_day_end: '2026-12-01' },
      '2026-12-01',
      true,
    ],
    [
      'an all-day visit through a leap day, seen that day',
      { last_timed_end: null, last_all_day_end: '2028-03-01' },
      '2028-02-29',
      false,
    ],
    [
      'an all-day visit through a leap day, seen the day after',
      { last_timed_end: null, last_all_day_end: '2028-03-01' },
      '2028-03-01',
      true,
    ],
    [
      'a visit long past',
      { last_timed_end: '2025-12-31T12:00:00Z', last_all_day_end: null },
      '2026-11-17',
      true,
    ],
  ];
  for (const [name, ends, today, isPast] of pastCases) {
    test(`past its last visit: ${name}`, () => {
      const tasks = toOverdueJobTasks([overdue(ends)], today);
      expect(tasks.map((task) => task.sourceType)).toEqual(isPast ? ['job_past_last_visit'] : []);
    });
  }

  test('a job past its last visit names the day of that visit', () => {
    expect(
      toOverdueJobTasks(
        [overdue({ last_timed_end: '2026-11-30T22:59:00Z', job_number: null, title: 'Therme' })],
        '2026-12-01',
      ),
    ).toEqual([
      {
        sourceType: 'job_past_last_visit',
        sourceId: '0b8f6a52-1c3e-4a7d-9e21-5f4c3b2a1d02',
        jobLabel: 'Therme',
        jobHref: '/auftraege/0b8f6a52-1c3e-4a7d-9e21-5f4c3b2a1d02',
        lastVisitDate: '2026-11-30',
      },
    ]);
  });

  test('the longest overdue job comes first', () => {
    const tasks = toOverdueJobTasks(
      [
        overdue({ id: '0b8f6a52-1c3e-4a7d-9e21-5f4c3b2a1d21', last_timed_end: '2026-11-10T10:00:00Z' }),
        overdue({ id: '0b8f6a52-1c3e-4a7d-9e21-5f4c3b2a1d22', last_all_day_end: '2026-11-03' }),
      ],
      '2026-11-17',
    );
    expect(tasks.map((task) => task.sourceId)).toEqual([
      '0b8f6a52-1c3e-4a7d-9e21-5f4c3b2a1d22',
      '0b8f6a52-1c3e-4a7d-9e21-5f4c3b2a1d21',
    ]);
  });
});
