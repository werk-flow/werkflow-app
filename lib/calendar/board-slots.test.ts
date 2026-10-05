import { describe, expect, test } from 'bun:test';
import type { CalendarBoardRow } from './board';
import type { BoardRowModel } from './board-model';
import {
  boardRowRecordId,
  boardSlotAtPoint,
  boardSlotRect,
  findBoardRowModel,
  resizedBarSpan,
} from './board-slots';

const starts = { rowStarts: [100, 140, 200], columnStarts: [50, 150, 250, 350] };

function personRow(employeeRecordId: string): BoardRowModel {
  const row: CalendarBoardRow = {
    employeeRecordId,
    userId: null,
    displayName: employeeRecordId,
    role: null,
    hasLogin: false,
    teamId: null,
    teamName: null,
    entryDate: null,
    exitDate: null,
  };
  return { key: employeeRecordId, kind: 'person', row };
}

describe('board slot geometry', () => {
  test('finds the row and column under a point', () => {
    expect(boardSlotAtPoint({ ...starts, point: { x: 160, y: 150 }, scrollDelta: { x: 0, y: 0 } })).toEqual({
      rowIndex: 1,
      columnIndex: 1,
    });
  });

  test('adds the scroll since the measurement before the lookup', () => {
    expect(boardSlotAtPoint({ ...starts, point: { x: 60, y: 110 }, scrollDelta: { x: 100, y: 40 } })).toEqual(
      {
        rowIndex: 1,
        columnIndex: 1,
      },
    );
  });

  test('returns null outside the measured rows or columns', () => {
    expect(boardSlotAtPoint({ ...starts, point: { x: 40, y: 150 }, scrollDelta: { x: 0, y: 0 } })).toBeNull();
    expect(
      boardSlotAtPoint({ ...starts, point: { x: 160, y: 200 }, scrollDelta: { x: 0, y: 0 } }),
    ).toBeNull();
  });

  test('measures a slot rectangle in content space and rounds it', () => {
    expect(
      boardSlotRect({ ...starts, rowIndex: 1, columnIndex: 2, contentTop: 90.4, contentLeft: 20.6 }),
    ).toEqual({ left: 229, top: 50, width: 100, height: 60 });
  });
});

describe('board row lookup', () => {
  test('a person row stands for its record and the unassigned row for none', () => {
    expect(boardRowRecordId(personRow('record-a'))).toBe('record-a');
    expect(boardRowRecordId({ key: 'unassigned', kind: 'unassigned', row: null })).toBeNull();
  });

  test('finds the row of a record, the unassigned row for null, and null when missing', () => {
    const unassigned: BoardRowModel = { key: 'unassigned', kind: 'unassigned', row: null };
    const rows = [personRow('record-a'), unassigned];
    expect(findBoardRowModel(rows, 'record-a')?.key).toBe('record-a');
    expect(findBoardRowModel(rows, null)).toBe(unassigned);
    expect(findBoardRowModel(rows, 'record-b')).toBeNull();
  });
});

describe('resized bar span', () => {
  test('moves the start edge inside the span', () => {
    expect(
      resizedBarSpan({
        startDate: '2026-10-05',
        endDateExclusive: '2026-10-08',
        edge: 'start',
        targetDate: '2026-10-06',
      }),
    ).toEqual({ plannedDate: '2026-10-06', durationDays: 2, endDateExclusive: '2026-10-08' });
  });

  test('extends the end edge and treats a missing end as one day', () => {
    expect(
      resizedBarSpan({
        startDate: '2026-10-05',
        endDateExclusive: null,
        edge: 'end',
        targetDate: '2026-10-07',
      }),
    ).toEqual({ plannedDate: '2026-10-05', durationDays: 3, endDateExclusive: '2026-10-08' });
  });

  test('refuses an edge that would invert the span or change nothing', () => {
    expect(
      resizedBarSpan({
        startDate: '2026-10-05',
        endDateExclusive: '2026-10-08',
        edge: 'start',
        targetDate: '2026-10-09',
      }),
    ).toBeNull();
    expect(
      resizedBarSpan({
        startDate: '2026-10-05',
        endDateExclusive: '2026-10-08',
        edge: 'end',
        targetDate: '2026-10-04',
      }),
    ).toBeNull();
    expect(
      resizedBarSpan({
        startDate: '2026-10-05',
        endDateExclusive: '2026-10-08',
        edge: 'end',
        targetDate: '2026-10-07',
      }),
    ).toBeNull();
  });

  test('refuses a bar without a start date', () => {
    expect(
      resizedBarSpan({ startDate: null, endDateExclusive: null, edge: 'end', targetDate: '2026-10-07' }),
    ).toBeNull();
  });
});
