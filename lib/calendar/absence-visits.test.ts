import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { absenceVisitWindow, OPEN_ABSENCE_LOOKAHEAD_DAYS } from './absence-visits-types';

test('a sickness recorded over a dispatched visit lists that visit with its dispatch state, for the office only', async () => {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, '../testing/fixtures/absence-affected-visits.ts')],
    { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
});

test('the affected list covers the absence, or two weeks from its start or today for an open end', () => {
  expect(absenceVisitWindow({ startDate: '2026-10-30', endDate: '2026-11-03' }, '2026-11-08')).toEqual({
    from: '2026-10-30',
    to: '2026-11-03',
  });
  expect(OPEN_ABSENCE_LOOKAHEAD_DAYS).toBe(14);
  // Recorded afterwards: the open end still looks two weeks past today.
  expect(absenceVisitWindow({ startDate: '2026-10-30', endDate: null }, '2026-11-08')).toEqual({
    from: '2026-10-30',
    to: '2026-11-21',
  });
  // Recorded ahead: two weeks from the start.
  expect(absenceVisitWindow({ startDate: '2026-12-01', endDate: null }, '2026-11-08')).toEqual({
    from: '2026-12-01',
    to: '2026-12-14',
  });
  // More than a year is cut at one year.
  expect(absenceVisitWindow({ startDate: '2026-01-01', endDate: '2027-06-30' }, '2026-11-08')?.to).toBe(
    '2027-01-01',
  );
});

test('a date that does not exist or an end before the start has no window', () => {
  expect(absenceVisitWindow({ startDate: '2026-02-30', endDate: null }, '2026-11-08')).toBeNull();
  expect(absenceVisitWindow({ startDate: '2026-11-03', endDate: '2026-11-02' }, '2026-11-08')).toBeNull();
});
