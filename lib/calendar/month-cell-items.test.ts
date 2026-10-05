import { describe, expect, test } from 'bun:test';
import { isMultiDay, monthCellItemsByDate } from './month-cell-items';
import type { CalendarJob } from '@/lib/jobs/types';
import type { CalendarWorkBlock } from '@/lib/time-tracking/calendar-blocks';
import type { TimeEntry } from '@/lib/time-tracking/types';

const job = (overrides: Partial<CalendarJob>): CalendarJob => ({
  id: 'o',
  occurrenceId: 'o',
  title: 'Wartung Heizung',
  jobNumber: 'AUF-1',
  status: 'nicht_bearbeitet',
  executionState: null,
  priority: 'mittel',
  plannedDate: '2026-10-05',
  plannedTime: '09:00',
  estimatedDurationMinutes: 60,
  plannedWorkingMinutes: null,
  location: 'Berlin',
  clientName: 'Müller GmbH',
  clientAddress: null,
  projectName: null,
  projectNumber: null,
  assignedUserIds: ['u1'],
  assignedEmployeeRecordIds: ['r1'],
  ...overrides,
});

const entry: TimeEntry = {
  id: 'e',
  userId: 'u1',
  organizationId: 'org',
  entryType: 'clock_in',
  timestamp: '2026-10-05T07:30:00',
  isManual: false,
  jobId: null,
  status: 'approved',
  reviewedBy: null,
  reviewedAt: null,
  createdAt: '2026-10-05T07:30:00',
  updatedAt: '2026-10-05T07:30:00',
};

const block = (overrides: Partial<CalendarWorkBlock>): CalendarWorkBlock => ({
  id: 'b',
  userId: 'u1',
  organizationId: 'org',
  jobId: null,
  start: '2026-10-05T07:30:00',
  end: '2026-10-05T10:00:00',
  startEntry: entry,
  endEntry: null,
  segments: [],
  sourceEntries: [entry],
  isOpen: false,
  isOnBreak: false,
  isComposite: false,
  isPending: false,
  ...overrides,
});

const range = { from: '2026-09-28', to: '2026-11-08' };

describe('month multi-day visits', () => {
  test('a visit longer than one day is multi-day, a one-day or open-ended visit is not', () => {
    expect(isMultiDay(job({ plannedDate: '2026-10-05', endDateExclusive: '2026-10-07' }))).toBe(true);
    expect(isMultiDay(job({ plannedDate: '2026-10-05', endDateExclusive: '2026-10-06' }))).toBe(false);
    expect(isMultiDay(job({ plannedDate: '2026-10-05', endDateExclusive: null }))).toBe(false);
  });
});

describe('month cell items', () => {
  test('lists single-day visits in range and leaves multi-day visits to the bars', () => {
    const { itemsByDate } = monthCellItemsByDate({
      jobs: [
        job({ id: 'single' }),
        job({ id: 'multi', endDateExclusive: '2026-10-08' }),
        job({ id: 'outside', plannedDate: '2026-12-01' }),
        job({ id: 'unplanned', plannedDate: null }),
      ],
      blocksByUser: new Map(),
      nameByUser: new Map(),
      nowTick: 0,
      range,
    });
    expect([...itemsByDate].map(([date, items]) => [date, items.map((item) => item.key)])).toEqual([
      ['2026-10-05', ['single']],
    ]);
  });

  test('adds work blocks with minutes and the member name, sorted with visits by start time', () => {
    const { itemsByDate, blocksByUserDate } = monthCellItemsByDate({
      jobs: [job({ id: 'visit', plannedTime: '09:00' })],
      blocksByUser: new Map([['u1', [block({ id: 'early' })]]]),
      nameByUser: new Map([['u1', 'Anna Berg']]),
      nowTick: 0,
      range,
    });
    const items = itemsByDate.get('2026-10-05') ?? [];
    expect(items.map((item) => item.key)).toEqual(['early', 'visit']);
    const first = items[0];
    expect(first?.kind === 'block' ? [first.name, first.startMinutes, first.endMinutes] : null).toEqual([
      'Anna Berg',
      450,
      600,
    ]);
    expect(blocksByUserDate.get('u1:2026-10-05')).toEqual([
      {
        id: 'early',
        startMs: new Date('2026-10-05T07:30:00').getTime(),
        endMs: new Date('2026-10-05T10:00:00').getTime(),
      },
    ]);
  });

  test('ends an open block at the tick and names an unknown member generically', () => {
    const nowTick = new Date('2026-10-05T08:30:00').getTime();
    const { itemsByDate } = monthCellItemsByDate({
      jobs: [],
      blocksByUser: new Map([['u2', [block({ id: 'open', userId: 'u2', end: null, isOpen: true })]]]),
      nameByUser: new Map(),
      nowTick,
      range,
    });
    const item = itemsByDate.get('2026-10-05')?.[0];
    expect(item?.kind === 'block' ? [item.name, item.endMinutes] : null).toEqual(['Mitarbeiter', 510]);
  });
});
