// A Boat run's cost record (lib/testing/boat/boat-runs.ts): it holds synthetic metadata only, never
// fails the run it records, makes the whole file unreadable when one line is, and splits a kept
// machine's running total into each run's own dollars.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BOAT_RUNS_FILE,
  type BoatRun,
  boatRunDollars,
  boatRunStart,
  readBoatRuns,
  recordBoatRun,
  testedCommit,
} from './boat-runs';

let checkout = '';
beforeEach(() => {
  checkout = mkdtempSync(join(tmpdir(), 'boat-runs-'));
});
afterEach(() => rmSync(checkout, { recursive: true, force: true }));

/** A run's start in a checkout whose reports can be read, of the commit packing read. */
function started(head: string | null = null): NonNullable<ReturnType<typeof boatRunStart>> {
  const start = boatRunStart(checkout, head);
  if (!start) throw new Error('The test checkout has unreadable reports.');
  return start;
}

const run = (machine: string, minute: number, dollars: number | null): Omit<BoatRun, 'version'> => ({
  machine,
  startedAt: new Date(Date.UTC(2026, 10, 21, 8, minute)).toISOString(),
  completedAt: new Date(Date.UTC(2026, 10, 21, 8, minute + 5)).toISOString(),
  head: 'c'.repeat(40),
  reports: ['2026-11-21T08-00-00-000Z-ab12'],
  usage: dollars === null ? null : { seconds: dollars * 1000, dollars },
});

test('a run is recorded with the commit it packed and the report folders it returned, and read back', () => {
  const head = 'c'.repeat(40);
  mkdirSync(join(checkout, '.agent-logs/verification/earlier'), { recursive: true });
  const start = started(head);
  mkdirSync(join(checkout, '.agent-logs/verification/returned'));
  recordBoatRun(checkout, { machine: 'bx_aaaaaaaa', started: start, usage: { seconds: 300, dollars: 0.05 } });
  const runs = readBoatRuns(join(checkout, BOAT_RUNS_FILE));
  if ('unreadable' in runs) throw new Error(runs.unreadable);
  expect(runs.map((run) => run.completedAt >= start.startedAt)).toEqual([true]);
  expect(runs.map((run) => ({ ...run, completedAt: start.startedAt }))).toEqual([
    {
      version: 1,
      machine: 'bx_aaaaaaaa',
      startedAt: start.startedAt,
      completedAt: start.startedAt,
      head,
      reports: ['returned'],
      usage: { seconds: 300, dollars: 0.05 },
    },
  ]);
  expect(readBoatRuns(join(checkout, 'missing.jsonl'))).toEqual([]);
});

test('a run on uncommitted work counts to no commit', () => {
  expect(testedCommit('c'.repeat(40), [])).toBe('c'.repeat(40));
  expect(testedCommit('c'.repeat(40), ['work.ts'])).toBeNull();
  expect(testedCommit('HEAD', [])).toBeNull();
});

test('a record that cannot be written only warns, and one without a usable machine id is never written', () => {
  const start = started();
  writeFileSync(join(checkout, '.agent-logs'), 'a file where the folder belongs');
  expect(() =>
    recordBoatRun(checkout, { machine: 'bx_aaaaaaaa', started: start, usage: undefined }),
  ).not.toThrow();
  rmSync(join(checkout, '.agent-logs'));
  recordBoatRun(checkout, { machine: '/home/someone', started: start, usage: undefined });
  expect(readBoatRuns(join(checkout, BOAT_RUNS_FILE))).toEqual([]);
  // A run whose commit packing could not tell is recorded without one, never with a guess.
  recordBoatRun(checkout, { machine: 'bx_aaaaaaaa', started: start, usage: undefined });
  expect(readBoatRuns(join(checkout, BOAT_RUNS_FILE))).toMatchObject([{ head: null, usage: null }]);
});

test('a checkout whose reports cannot be read records no start, and its run goes on', () => {
  mkdirSync(join(checkout, '.agent-logs'));
  writeFileSync(join(checkout, '.agent-logs/verification'), 'a file where the folder belongs');
  expect(boatRunStart(checkout, null)).toBeUndefined();
});

test('one unreadable line makes the whole file unreadable, so no run is silently left out', () => {
  recordBoatRun(checkout, { machine: 'bx_aaaaaaaa', started: started(), usage: undefined });
  writeFileSync(join(checkout, BOAT_RUNS_FILE), `${readFileSync(join(checkout, BOAT_RUNS_FILE), 'utf8')}{\n`);
  expect(readBoatRuns(join(checkout, BOAT_RUNS_FILE))).toEqual({
    unreadable: `${join(checkout, BOAT_RUNS_FILE)}:2 is no JSON`,
  });
});

test("a kept machine's running total splits into each run's own dollars; a missing total leaves them unknown", () => {
  const runs = [
    run('bx_aaaaaaaa', 20, 0.12),
    run('bx_aaaaaaaa', 0, 0.05),
    run('bx_bbbbbbbb', 10, 0.03),
    run('bx_bbbbbbbb', 30, null),
    run('bx_bbbbbbbb', 40, 0.09),
  ].map((entry): BoatRun => ({ version: 1, ...entry }));
  expect(
    boatRunDollars(runs).map(({ run: entry, dollars }) => [
      entry.machine,
      entry.startedAt.slice(11, 16),
      dollars,
    ]),
  ).toEqual([
    ['bx_aaaaaaaa', '08:00', 0.05],
    ['bx_bbbbbbbb', '08:10', 0.03],
    ['bx_aaaaaaaa', '08:20', 0.12 - 0.05],
    ['bx_bbbbbbbb', '08:30', null],
    // The run before it gave no total, so its own share cannot be told apart.
    ['bx_bbbbbbbb', '08:40', null],
  ]);
});
