import { describe, expect, test } from 'bun:test';
import {
  canReuseWindowRead,
  followSupersededReads,
  planRunningWindowRead,
  windowRangeToRead,
} from './window-read-plan';

const day = (date: string) => new Date(`${date}T00:00:00`);
const week = { start: day('2026-10-05'), end: day('2026-10-11') };
const month = { start: day('2026-09-28'), end: day('2026-11-08') };
const monday = { start: day('2026-10-05'), end: day('2026-10-05') };

describe('windowRangeToRead', () => {
  test('a request inside the one committed window refreshes that window', () => {
    expect(windowRangeToRead([month, month, month], monday)).toBe(month);
  });

  test('no coverage, a partial cover or split windows read the request', () => {
    expect(windowRangeToRead([null, month], monday)).toBe(monday);
    expect(windowRangeToRead([week, week], month)).toBe(month);
    expect(windowRangeToRead([month, week], monday)).toBe(monday);
    expect(windowRangeToRead([month, null], monday)).toBe(monday);
  });
});

describe('canReuseWindowRead', () => {
  const running = {
    scopeKey: 'org:user:admin',
    startedAt: 100,
    range: week,
    generations: { entries: 3, board: 7 },
  };
  const base = {
    running,
    scopeKey: 'org:user:admin',
    range: { start: day('2026-10-05'), end: day('2026-10-11') },
    invalidatedAt: undefined,
    datasets: ['entries', 'board'] as const,
    currentGeneration: (dataset: 'entries' | 'board') => (dataset === 'entries' ? 3 : 7),
  };

  test('a current read of the same scope and range is shared', () => {
    expect(canReuseWindowRead(base)).toBe(true);
    expect(canReuseWindowRead({ ...base, invalidatedAt: 99 })).toBe(true);
  });

  test('another scope, another range, a newer generation or an older start reads again', () => {
    expect(canReuseWindowRead({ ...base, scopeKey: 'org:user:buero' })).toBe(false);
    expect(canReuseWindowRead({ ...base, range: month })).toBe(false);
    expect(canReuseWindowRead({ ...base, currentGeneration: () => 8 })).toBe(false);
    expect(canReuseWindowRead({ ...base, invalidatedAt: 100 })).toBe(false);
  });
});

describe('planRunningWindowRead', () => {
  const nextWeek = { start: day('2026-10-12'), end: day('2026-10-18') };

  test('returning to a covered window cancels a read that only filled another window', () => {
    expect(
      planRunningWindowRead({
        running: { range: nextWeek, purpose: 'coverage' },
        needed: week,
        neededCovered: true,
      }),
    ).toBe('cancel');
  });

  test('a cancelled catch-up or settlement read is replaced by a read of the needed window', () => {
    expect(
      planRunningWindowRead({
        running: { range: nextWeek, purpose: 'freshness' },
        needed: week,
        neededCovered: true,
      }),
    ).toBe('replace');
  });

  test('a read that covers the needed window, an uncovered window or no read keeps running', () => {
    expect(
      planRunningWindowRead({
        running: { range: month, purpose: 'coverage' },
        needed: week,
        neededCovered: true,
      }),
    ).toBe('keep');
    expect(
      planRunningWindowRead({
        running: { range: nextWeek, purpose: 'coverage' },
        needed: week,
        neededCovered: false,
      }),
    ).toBe('keep');
    expect(planRunningWindowRead({ running: null, needed: week, neededCovered: true })).toBe('keep');
  });
});

describe('followSupersededReads', () => {
  test('a superseded read follows the read that took over until one settles', async () => {
    const outcomes: Array<'committed' | 'failed' | 'superseded'> = ['superseded', 'superseded', 'committed'];
    let reads = 0;
    const outcome = await followSupersededReads(
      async () => outcomes[reads++] ?? 'failed',
      () => true,
    );
    expect(outcome).toBe('committed');
    expect(reads).toBe(3);
  });

  test('a failure is reported once and a lost scope stops following', async () => {
    let reads = 0;
    expect(
      await followSupersededReads(
        async () => (reads++, 'failed' as const),
        () => true,
      ),
    ).toBe('failed');
    expect(reads).toBe(1);
    expect(
      await followSupersededReads(
        async () => 'superseded' as const,
        () => false,
      ),
    ).toBe('superseded');
  });
});
