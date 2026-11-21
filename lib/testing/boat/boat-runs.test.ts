// A Boat run's cost record (lib/testing/boat/boat-runs.ts): it holds synthetic metadata only, never
// fails the run it records, makes the whole file unreadable when one line is, and splits a kept
// machine's running total into each run's own dollars.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
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
} from './boat-runs';

let checkout = '';
beforeEach(() => {
  checkout = mkdtempSync(join(tmpdir(), 'boat-runs-'));
});
afterEach(() => rmSync(checkout, { recursive: true, force: true }));

const run = (machine: string, minute: number, dollars: number | null): Omit<BoatRun, 'version'> => ({
  machine,
  startedAt: new Date(Date.UTC(2026, 10, 21, 8, minute)).toISOString(),
  completedAt: new Date(Date.UTC(2026, 10, 21, 8, minute + 5)).toISOString(),
  head: 'c'.repeat(40),
  reports: ['2026-11-21T08-00-00-000Z-ab12'],
  usage: dollars === null ? null : { seconds: dollars * 1000, dollars },
});

test('a run is recorded with its commit and the report folders it returned, and read back', () => {
  execFileSync('git', ['init', '--quiet', checkout]);
  execFileSync(
    'git',
    [
      '-c',
      'user.name=ci',
      '-c',
      'user.email=ci@example.invalid',
      'commit',
      '--quiet',
      '--allow-empty',
      '-m',
      'head',
    ],
    { cwd: checkout },
  );
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' }).trim();
  mkdirSync(join(checkout, '.agent-logs/verification/earlier'), { recursive: true });
  const started = boatRunStart(checkout);
  mkdirSync(join(checkout, '.agent-logs/verification/returned'));
  recordBoatRun(checkout, { machine: 'bx_aaaaaaaa', started, usage: { seconds: 300, dollars: 0.05 } });
  const runs = readBoatRuns(join(checkout, BOAT_RUNS_FILE));
  if ('unreadable' in runs) throw new Error(runs.unreadable);
  expect(runs.map((run) => run.completedAt >= started.startedAt)).toEqual([true]);
  expect(runs.map((run) => ({ ...run, completedAt: started.startedAt }))).toEqual([
    {
      version: 1,
      machine: 'bx_aaaaaaaa',
      startedAt: started.startedAt,
      completedAt: started.startedAt,
      head,
      reports: ['returned'],
      usage: { seconds: 300, dollars: 0.05 },
    },
  ]);
  expect(readBoatRuns(join(checkout, 'missing.jsonl'))).toEqual([]);
});

test('a record that cannot be written only warns, and one without a usable machine id is never written', () => {
  const started = boatRunStart(checkout);
  writeFileSync(join(checkout, '.agent-logs'), 'a file where the folder belongs');
  expect(() => recordBoatRun(checkout, { machine: 'bx_aaaaaaaa', started, usage: undefined })).not.toThrow();
  rmSync(join(checkout, '.agent-logs'));
  recordBoatRun(checkout, { machine: '/home/someone', started, usage: undefined });
  expect(readBoatRuns(join(checkout, BOAT_RUNS_FILE))).toEqual([]);
  // Outside git, the run's commit is unknown, never a guess.
  recordBoatRun(checkout, { machine: 'bx_aaaaaaaa', started, usage: undefined });
  expect(readBoatRuns(join(checkout, BOAT_RUNS_FILE))).toMatchObject([{ head: null, usage: null }]);
});

test('one unreadable line makes the whole file unreadable, so no run is silently left out', () => {
  recordBoatRun(checkout, { machine: 'bx_aaaaaaaa', started: boatRunStart(checkout), usage: undefined });
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
