import { describe, expect, test } from 'bun:test';

import { weekLabel, WEEKLY_NUMBER_SECTIONS, type WeeklyNumbers } from './format';

const rows = WEEKLY_NUMBER_SECTIONS.flatMap((section) => section.rows);
const cellOf = (id: string, week: WeeklyNumbers) => rows.find((row) => row.id === id)?.cell(week);

const emptyWeek: WeeklyNumbers = {
  weekStart: '2026-02-09',
  lastDay: '2026-02-15',
  overdue: {
    followUps: 0,
    requestCallbacks: 0,
    maintenance: 0,
    staleRequests: 0,
    waitingHandovers: 0,
    blockerReviews: 0,
  },
  handover: { released: 0, medianWorkdays: null, withinTwoWorkdays: 0 },
  workReports: { finished: 0, withReport: 0 },
  timeCapture: { entries: 0, byEmployee: 0 },
};

describe('weekly numbers', () => {
  test.each([
    ['2026-02-23', 9],
    ['2026-12-28', 53], // 2026 starts on a Thursday, so it has a week 53
    ['2027-01-04', 1],
    ['2028-02-28', 9], // the week of the leap day
    ['2024-12-30', 1], // a Monday in December that belongs to the next year's week 1
  ])('the week starting %s is calendar week %i', (weekStart, expected) => {
    expect(weekLabel({ weekStart, lastDay: weekStart }).title).toBe(`KW ${expected}`);
  });

  test('a week label names the calendar week and its days across a month end, the running week up to today', () => {
    expect(weekLabel({ weekStart: '2026-02-23', lastDay: '2026-03-01' })).toEqual({
      title: 'KW 9',
      range: '23.02.–01.03.',
    });
    expect(weekLabel({ weekStart: '2026-11-09', lastDay: '2026-11-11' }).range).toBe('09.11.–11.11.');
  });

  test('a share shows its percent with the counts, and a dash for a week with nothing to share', () => {
    const share = (byEmployee: number, entries: number) =>
      cellOf('selbst-erfasst', { ...emptyWeek, timeCapture: { entries, byEmployee } });
    expect(share(2, 3)).toEqual({ value: '67\u00a0%', detail: '2 von 3' });
    expect(share(0, 4)).toEqual({ value: '0\u00a0%', detail: '0 von 4' });
    expect(share(0, 0)).toEqual({ value: '–' });
  });

  test('the median shows one decimal at most, and a dash without a released handover', () => {
    const median = (medianWorkdays: number | null) =>
      cellOf('median', { ...emptyWeek, handover: { released: 2, medianWorkdays, withinTwoWorkdays: 1 } });
    expect(median(4.5)).toEqual({ value: '4,5' });
    expect(median(1)).toEqual({ value: '1' });
    expect(median(null)).toEqual({ value: '–' });
  });

  test('a week with zero jobs shows zero overdue items and dashes for every share and the median', () => {
    const cells = WEEKLY_NUMBER_SECTIONS.flatMap((section) =>
      section.rows.map((row) => [row.id, row.cell(emptyWeek).value]),
    );
    expect(Object.fromEntries(cells)).toEqual({
      rueckrufe: '0',
      nachfassen: '0',
      anfragen: '0',
      wartungen: '0',
      'uebergaben-offen': '0',
      pruefdatum: '0',
      'ueberfaellig-gesamt': '0',
      freigegeben: '0',
      median: '–',
      'zwei-werktage': '–',
      arbeitsberichte: '–',
      'selbst-erfasst': '–',
    });
  });

  test('the overdue total adds every overdue kind once', () => {
    const week: WeeklyNumbers = {
      ...emptyWeek,
      overdue: {
        followUps: 1,
        requestCallbacks: 2,
        maintenance: 3,
        staleRequests: 4,
        waitingHandovers: 5,
        blockerReviews: 6,
      },
    };
    const total = WEEKLY_NUMBER_SECTIONS.flatMap((section) => section.rows).find((row) => row.total);
    expect(total?.cell(week).value).toBe('21');
  });
});
