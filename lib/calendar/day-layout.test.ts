import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  fittedHourWidth,
  instantAtMinutes,
  jobStartMinutes,
  minutesIntoDay,
  packTimeLanes,
  resizedBlockUpdates,
  shiftedBlockUpdates,
  travelGaps,
  wallMinutesFrom,
} from './day-layout';
import type { TimeEntry } from '@/lib/time-tracking/types';

const entry = (id: string, entryType: TimeEntry['entryType'], timestamp: string): TimeEntry => ({
  id,
  entryType,
  timestamp,
  userId: 'u1',
  organizationId: 'org',
  status: 'approved',
  isManual: false,
  reviewedBy: null,
  reviewedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  jobId: null,
});

describe('day layout', () => {
  test('short blocks get separate readable lanes without extending recorded time', () => {
    const items = [
      { key: 'short', startMinutes: 480, endMinutes: 482 },
      { key: 'next', startMinutes: 483, endMinutes: 485 },
    ];
    const result = packTimeLanes(items, 72);
    expect(result.laneCount).toBe(2);
    expect(result.lanes[0]?.item.endMinutes).toBe(482);
    expect(result.lanes[1]?.item.endMinutes).toBe(485);
    expect(packTimeLanes(items, 2).laneCount).toBe(1);
  });
  test('overlapping items take separate lanes and touching items share one', () => {
    const { lanes, laneCount } = packTimeLanes([
      { key: 'a', startMinutes: 480, endMinutes: 600 },
      { key: 'b', startMinutes: 540, endMinutes: 660 },
      { key: 'c', startMinutes: 600, endMinutes: 720 },
    ]);
    expect(laneCount).toBe(2);
    expect(lanes.map(({ item, lane }) => [item.key, lane])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 0],
    ]);
  });

  test('the hour width fits the working hours and clamps the zoom', () => {
    expect(fittedHourWidth(1300, 1)).toBe(100);
    expect(fittedHourWidth(300, 1)).toBe(60);
    expect(fittedHourWidth(1300, 10)).toBe(400);
    expect(fittedHourWidth(1300, 0.1)).toBe(50);
  });

  test('minutes into the day clamp to the day and short gaps count as travel', () => {
    const dayStart = new Date(2026, 8, 8, 0, 0, 0);
    expect(minutesIntoDay(new Date(2026, 8, 8, 9, 30), dayStart)).toBe(570);
    expect(minutesIntoDay(new Date(2026, 8, 7, 23, 0), dayStart)).toBe(0);
    expect(minutesIntoDay(new Date(2026, 8, 9, 1, 0), dayStart)).toBe(1440);
    expect(
      travelGaps([
        { key: 'a', startMinutes: 480, endMinutes: 540 },
        { key: 'b', startMinutes: 570, endMinutes: 600 },
        { key: 'c', startMinutes: 900, endMinutes: 960 },
      ]),
    ).toEqual([{ startMinutes: 540, endMinutes: 570 }]);
    expect(jobStartMinutes({ plannedTime: '09:30' })).toBe(570);
    expect(jobStartMinutes({ plannedTime: null })).toBe(0);
  });

  test('a moved block shifts every entry together and a resized end drags a trailing break along', () => {
    const entries = [
      entry('in', 'clock_in', '2026-09-08T06:00:00.000Z'),
      entry('bs', 'break_start', '2026-09-08T10:00:00.000Z'),
      entry('be', 'break_end', '2026-09-08T10:30:00.000Z'),
      entry('out', 'clock_out', '2026-09-08T14:00:00.000Z'),
    ];
    expect(
      shiftedBlockUpdates(entries, 60 * 60_000, 'u2').map((update) => [
        update.entryId,
        update.newUserId,
        update.newTimestamp,
      ]),
    ).toEqual([
      ['in', 'u2', '2026-09-08T07:00:00.000Z'],
      ['bs', 'u2', '2026-09-08T11:00:00.000Z'],
      ['be', 'u2', '2026-09-08T11:30:00.000Z'],
      ['out', 'u2', '2026-09-08T15:00:00.000Z'],
    ]);
    expect(
      resizedBlockUpdates({
        sourceEntries: entries,
        clockInId: 'in',
        clockOutId: 'out',
        edge: 'start',
        newTimestamp: '2026-09-08T05:30:00.000Z',
        userId: 'u1',
      }),
    ).toEqual([{ entryId: 'in', newUserId: 'u1', newTimestamp: '2026-09-08T05:30:00.000Z' }]);
    expect(
      resizedBlockUpdates({
        sourceEntries: entries,
        clockInId: 'in',
        clockOutId: 'out',
        edge: 'end',
        newTimestamp: '2026-09-08T15:00:00.000Z',
        userId: 'u1',
      }),
    ).toEqual([{ entryId: 'out', newUserId: 'u1', newTimestamp: '2026-09-08T15:00:00.000Z' }]);
    const trailing = [
      entries[0],
      entries[1],
      entry('bs2', 'break_start', '2026-09-08T14:00:00.000Z'),
      entries[3],
    ].filter((value): value is TimeEntry => value !== undefined);
    expect(
      resizedBlockUpdates({
        sourceEntries: trailing,
        clockInId: 'in',
        clockOutId: 'out',
        edge: 'end',
        newTimestamp: '2026-09-08T15:00:00.000Z',
        userId: 'u1',
      }),
    ).toEqual([
      { entryId: 'out', newUserId: 'u1', newTimestamp: '2026-09-08T15:00:00.000Z' },
      { entryId: 'bs2', newUserId: 'u1', newTimestamp: '2026-09-08T15:00:00.000Z' },
    ]);
  });
});

describe('a DST day keeps the wall-clock grid', () => {
  // The day view runs in the browser's zone; the business zone is the one that has the DST days.
  const zone = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'Europe/Berlin';
  });
  afterAll(() => {
    process.env.TZ = zone;
  });

  test('on the fall-back day 10:00 sits at minute 600, not 660, and maps back to its instant', () => {
    const dayStart = new Date(2026, 9, 25);
    const tenAm = Date.parse('2026-10-25T09:00:00Z');
    expect(minutesIntoDay(new Date(tenAm), dayStart)).toBe(600);
    expect(instantAtMinutes(dayStart, 600)).toBe(tenAm);
    // The repeated hour shares its minutes: 02:30 summer time and 02:30 winter time.
    expect(wallMinutesFrom(dayStart, Date.parse('2026-10-25T00:30:00Z'))).toBe(150);
    expect(wallMinutesFrom(dayStart, Date.parse('2026-10-25T01:30:00Z'))).toBe(150);
    expect(minutesIntoDay(new Date(2026, 9, 26, 0, 30), dayStart)).toBe(1440);
  });

  test('on the spring-forward day 10:00 sits at minute 600 and the skipped hour moves forward', () => {
    const dayStart = new Date(2027, 2, 28);
    const tenAm = Date.parse('2027-03-28T08:00:00Z');
    expect(minutesIntoDay(new Date(tenAm), dayStart)).toBe(600);
    expect(instantAtMinutes(dayStart, 600)).toBe(tenAm);
    expect(instantAtMinutes(dayStart, 150)).toBe(Date.parse('2027-03-28T01:30:00Z'));
  });

  test('outside the day the minutes continue, as the labels of a block past midnight need', () => {
    const dayStart = new Date(2026, 9, 25);
    expect(wallMinutesFrom(dayStart, Date.parse('2026-10-25T23:30:00Z'))).toBe(24 * 60 + 30);
    expect(wallMinutesFrom(dayStart, Date.parse('2026-10-24T21:30:00Z'))).toBe(-30);
  });
});
