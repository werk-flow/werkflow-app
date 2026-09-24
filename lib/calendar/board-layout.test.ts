import { describe, expect, test } from 'bun:test';
import { barEdge, boardColumns, boardDateRange, minutesOfDay, mondayOf, packLanes } from './board-layout';

describe('board columns', () => {
  test('start on Monday, mark weekends and today, and hide weekends on request', () => {
    expect(mondayOf('2026-09-18')).toBe('2026-09-14');
    expect(mondayOf('2026-09-14')).toBe('2026-09-14');
    expect(mondayOf('2026-09-20')).toBe('2026-09-14');
    const columns = boardColumns({ anchorIso: '2026-09-18', horizonWeeks: 1, hideWeekends: false, todayIso: '2026-09-18' });
    expect(columns.map((column) => column.date)).toEqual(['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20']);
    expect(columns.filter((column) => column.isWeekend).map((column) => column.weekday)).toEqual([5, 6]);
    expect(columns.find((column) => column.isToday)?.date).toBe('2026-09-18');
    const workdays = boardColumns({ anchorIso: '2026-09-18', horizonWeeks: 2, hideWeekends: true, todayIso: '2026-01-01' });
    expect(workdays).toHaveLength(10);
    expect(workdays.at(-1)?.date).toBe('2026-09-25');
    expect(boardDateRange('2026-09-18', 6)).toEqual({ from: '2026-09-14', to: '2026-10-25' });
  });
});

describe('lane packing', () => {
  const columns = boardColumns({ anchorIso: '2026-09-14', horizonWeeks: 1, hideWeekends: false, todayIso: '2026-01-01' });

  test('packs bars first, keeps day order among cards, clips and drops by visibility', () => {
    const { lanes, laneCount } = packLanes(
      [
        { key: 'late', startDate: '2026-09-15', endDateExclusive: '2026-09-16', sortMinutes: 780 },
        { key: 'early', startDate: '2026-09-15', endDateExclusive: '2026-09-16', sortMinutes: 480 },
        { key: 'bar', startDate: '2026-09-15', endDateExclusive: '2026-09-18', sortMinutes: 0 },
        { key: 'clipped', startDate: '2026-09-12', endDateExclusive: '2026-09-15', sortMinutes: 0 },
        { key: 'outside', startDate: '2026-09-21', endDateExclusive: '2026-09-22', sortMinutes: 0 },
      ],
      columns,
    );
    expect(laneCount).toBe(3);
    expect(lanes.map((lane) => [lane.item.key, lane.lane, lane.column, lane.span])).toEqual([
      ['clipped', 0, 0, 1],
      ['bar', 0, 1, 3],
      ['early', 1, 1, 1],
      ['late', 2, 1, 1],
    ]);
  });

  test('a bar over a hidden weekend spans only the visible columns', () => {
    const workdays = boardColumns({ anchorIso: '2026-09-14', horizonWeeks: 2, hideWeekends: true, todayIso: '2026-01-01' });
    const { lanes } = packLanes([{ key: 'bar', startDate: '2026-09-18', endDateExclusive: '2026-09-22', sortMinutes: 0 }], workdays);
    expect(lanes[0]).toMatchObject({ column: 4, span: 2 });
  });

  test('bar edges and minutes of the day', () => {
    expect([barEdge(0, 1), barEdge(0, 3), barEdge(1, 3), barEdge(2, 3)]).toEqual(['single', 'start', 'middle', 'end']);
    expect(minutesOfDay('09:30')).toBe(570);
    expect(minutesOfDay(null)).toBe(0);
    expect(minutesOfDay('x')).toBe(0);
  });
});
