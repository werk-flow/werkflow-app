import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  admission,
  isStartKind,
  processTable,
  readMachineRoom,
  runningHeavyCommands,
  type RoomReading,
  type StartKind,
} from './machine-room';

const GIB = 1024 ** 3;
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'werkflow-machine-room-'));
  directories.push(directory);
  return directory;
}

const watched = (available: number, floor: number, blocked: string | null = null): RoomReading => ({
  room: { available: available * GIB, floor: floor * GIB, blocked, alerted: false },
});
const UNWATCHED: RoomReading = { unwatched: 'no load watch at /nowhere', fix: 'Install the load watch.' };
const admitted = (start: StartKind, reading: RoomReading, heavy: readonly number[] = []): boolean =>
  admission(
    start,
    reading,
    heavy.map((use) => use * GIB),
  ).admitted;

// The watch sets the floor at 10 % of RAM and raises it to 20 % while its alert is open or swap fills
// (werk-flow/werkflow-planning ops/workstation-load.py). The costs are this module's: 4, 0.1 and 0.5 GiB.
test('each machine admits a start exactly when its cost fits above the floor', () => {
  for (const [machine, floor] of [
    ['the PC, 15.6 GiB', 1.56],
    ['the PC while its alert is open', 3.12],
    ['the Mac, 18 GiB', 1.8],
    ['the Mac while its alert is open', 3.6],
    ['the VM, 32 GiB', 3.2],
    ['the VM while its alert is open', 6.4],
  ] as const) {
    const at = (available: number): RoomReading => watched(available, floor);
    // A further heavy command beside one that has used nothing yet: its own 4 GiB on top of the other's 4.
    expect([machine, admitted('heavy', at(floor + 8.01), [0])]).toEqual([machine, true]);
    expect([machine, admitted('heavy', at(floor + 7.99), [0])]).toEqual([machine, false]);
    expect([machine, admitted('setup', at(floor + 0.11))]).toEqual([machine, true]);
    expect([machine, admitted('setup', at(floor + 0.09))]).toEqual([machine, false]);
    expect([machine, admitted('thread', at(floor + 4.51))]).toEqual([machine, true]);
    expect([machine, admitted('thread', at(floor + 4.49))]).toEqual([machine, false]);
  }
});

test('the overload of 2026-11-11 replayed: one heavy command at a time, and no setup once the room is at the floor', () => {
  // 18 agent processes held 4.4 GiB and the stack up to 2.1, which left the 15.6 GiB PC at most 9.1.
  const incident = watched(9.1, 1.56);
  expect(admitted('heavy', incident)).toBe(true);
  // The first command reserves 4 GiB as it starts: 5.1 of room is under the 5.56 a second one needs.
  expect(admitted('heavy', incident, [0])).toBe(false);
  expect(admission('heavy', incident, [0]).reason).toContain(
    '5.1 GiB of room (9.1 available, 4.0 still reserved',
  );
  expect(admitted('setup', incident, [0])).toBe(true);
  // 5.6 available beside a command that still reserves its 4 GiB is 1.6 of room: under the floor plus 0.1.
  expect(admitted('setup', watched(5.6, 1.56), [0])).toBe(false);
  // The thread gate alone admitted the 18th agent; it refuses once less than 6.06 GiB is left.
  expect(admitted('thread', incident)).toBe(true);
  expect(admitted('thread', watched(6.0, 1.56))).toBe(false);
});

test('the only heavy command runs whenever the machine is not blocked, and says when it has no measured room', () => {
  // A machine full of idle agents must still verify, one command at a time.
  const full = admission('heavy', watched(2, 1.56), []);
  expect(full).toMatchObject({ admitted: true, measured: false });
  expect(full.reason).toContain('It is the only heavy command, so it runs without measured room.');
  expect(admission('heavy', watched(9, 1.56), [])).toMatchObject({ admitted: true, measured: true });
  expect(admitted('heavy', watched(2, 1.56), [1])).toBe(false);
});

test('a running heavy command reserves only what it has not used yet, and a thread counts what it holds', () => {
  // 7 GiB available beside a command that already holds 3.5 of its 4: 6.5 of room fits a second one (5.56).
  expect(admitted('heavy', watched(7, 1.56), [3.5])).toBe(true);
  expect(admitted('heavy', watched(7, 1.56), [0.5])).toBe(false);
  // A command past its estimate reserves nothing more and never adds room.
  expect(admission('heavy', watched(7, 1.56), [6 * GIB]).reason).toContain('0.0 still reserved');
  // Heavy commands aside: 3 GiB available while a check holds 3.5 is the same machine as 6.5 available.
  expect(admitted('thread', watched(3, 1.56), [3.5])).toBe(true);
  expect(admitted('thread', watched(3, 1.56), [2])).toBe(false);
  // All of what a command holds counts, also past its 4 GiB estimate: it frees that much when it ends.
  expect(admitted('thread', watched(2, 1.56), [5])).toBe(true);
  expect(admitted('thread', watched(2, 1.56), [4])).toBe(false);
});

test('a blocked machine takes no start of any kind', () => {
  const blocked = watched(14, 1.56, 'the 5-minute load is 40.0 on 14 cores, above 35.0');
  for (const start of ['heavy', 'setup', 'thread'] as const) {
    const verdict = admission(start, blocked, []);
    expect(verdict.admitted).toBe(false);
    expect(verdict.reason).toBe(
      'This machine takes no start now: the 5-minute load is 40.0 on 14 cores, above 35.0.',
    );
  }
});

test('a machine without the watch keeps a heavy command and a setup going and refuses a thread with the install command', () => {
  expect(admission('heavy', UNWATCHED, [])).toMatchObject({
    admitted: true,
    measured: false,
    unwatched: true,
  });
  expect(admission('setup', UNWATCHED, [])).toMatchObject({
    admitted: true,
    measured: false,
    unwatched: true,
  });
  const thread = admission('thread', UNWATCHED, []);
  expect(thread).toMatchObject({ admitted: false, unwatched: true });
  expect(thread.reason).toBe(
    "This machine's memory is not measured: no load watch at /nowhere. Install the load watch.",
  );
});

function fixOf(reading: RoomReading): { unwatched: string; fix: string } {
  if ('room' in reading) throw new Error('The machine has a reading.');
  return reading;
}

function watchAnswering(status: number | null, stdout: string, stderr = ''): RoomReading {
  const script = join(temporaryDirectory(), 'workstation-load.py');
  writeFileSync(script, '');
  const calls: string[][] = [];
  const reading = readMachineRoom(
    { WERKFLOW_LOAD_WATCH: script },
    (command, args) => {
      calls.push([command, ...args]);
      return { status, stdout, stderr };
    },
    'linux',
  );
  expect(calls).toEqual([['python3', '-I', script, '--room']]);
  return reading;
}

test('the room is the answer of the load watch', () => {
  expect(
    watchAnswering(
      0,
      '{"available": 10956226560, "floor": 1677124812, "blocked": null, "alerted": false, "watching": true}\n',
    ),
  ).toEqual({ room: { available: 10956226560, floor: 1677124812, blocked: null, alerted: false } });
  expect(
    watchAnswering(
      0,
      '{"available": 1, "floor": 2, "blocked": "macOS reports memory pressure: warn", "alerted": true, "watching": true}',
    ),
  ).toEqual({
    room: { available: 1, floor: 2, blocked: 'macOS reports memory pressure: warn', alerted: true },
  });
});

test('a missing, stopped, failing or unreadable watch is no reading, never an empty room', () => {
  const missing = readMachineRoom({ WERKFLOW_LOAD_WATCH: join(temporaryDirectory(), 'absent.py') }, () => {
    throw new Error('A missing watch is never run.');
  });
  expect(fixOf(missing).unwatched).toStartWith('no load watch at ');

  // The checkout is there but the timer is not installed: "alerted" would stay false forever.
  const stopped = watchAnswering(
    0,
    '{"available": 1, "floor": 2, "blocked": null, "alerted": false, "watching": false}',
  );
  expect(stopped).toMatchObject({
    unwatched: 'the load watch has the script but its timer wrote no sample in 5 minutes',
  });

  const failed = watchAnswering(1, '', "Traceback (most recent call last):\nKeyError: 'MemAvailable'\n");
  expect(failed).toMatchObject({
    unwatched: "the load watch gave no reading (exit 1: KeyError: 'MemAvailable')",
  });
  expect(watchAnswering(null, '')).toMatchObject({ unwatched: 'the load watch gave no reading (exit null)' });

  for (const answer of [
    '',
    'not json',
    '[]',
    '{"available": "10", "floor": 2, "blocked": null, "alerted": false, "watching": true}',
    '{"available": 1, "floor": 2, "alerted": false, "watching": true}',
  ])
    expect(watchAnswering(0, answer)).toMatchObject({ unwatched: 'the load watch gave no reading (exit 0)' });
});

test('a machine without python3, or without ps, is an unwatched machine and never a crash', () => {
  const script = join(temporaryDirectory(), 'workstation-load.py');
  writeFileSync(script, '');
  const path = process.env.PATH;
  process.env.PATH = temporaryDirectory();
  try {
    const reading = readMachineRoom({ WERKFLOW_LOAD_WATCH: script });
    expect(fixOf(reading).unwatched).toStartWith('the load watch gave no reading (exit null: ');
    expect(fixOf(reading).unwatched).toContain('python3');
    expect(processTable()).toEqual([]);
  } finally {
    process.env.PATH = path;
  }
});

test('the fix names the install of the machine it runs on', () => {
  const absent = { WERKFLOW_LOAD_WATCH: join(temporaryDirectory(), 'absent.py') };
  const never = (): never => {
    throw new Error('A missing watch is never run.');
  };
  expect(fixOf(readMachineRoom(absent, never, 'darwin')).fix).toContain(
    'git pull --ff-only && python3 ops/install-mac.py',
  );
  expect(fixOf(readMachineRoom(absent, never, 'linux')).fix).toContain(
    'systemctl --user enable --now workstation-load.timer',
  );
});

test('the process table is every pid with its parent and resident bytes', () => {
  const rows = processTable(() => ({
    status: 0,
    stdout: '    1     0  12400\n  812     1 353000\n\n  bad line\n',
    stderr: '',
  }));
  expect(rows).toEqual([
    { pid: 1, parent: 0, resident: 12400 * 1024 },
    { pid: 812, parent: 1, resident: 353000 * 1024 },
  ]);
});

test('a running heavy command is the whole process tree of the pid its slot file names', () => {
  const directory = temporaryDirectory();
  writeFileSync(join(directory, 'slot-0'), '500\n'); // check:changed with tsc and eslint below it
  writeFileSync(join(directory, 'slot-1'), '900\n'); // its owner was killed: no such process
  writeFileSync(join(directory, 'slot-2'), ''); // released
  writeFileSync(join(directory, 'setup.lock'), '500\n'); // not a slot
  const row = (pid: number, parent: number, mebibytes: number) => ({
    pid,
    parent,
    resident: mebibytes * 1024 ** 2,
  });
  const processes = [
    row(1, 0, 10),
    row(500, 1, 100),
    row(501, 500, 2000),
    row(502, 501, 900),
    row(700, 1, 4000),
  ];
  expect(runningHeavyCommands(directory, processes)).toEqual([3000 * 1024 ** 2]);
  expect(runningHeavyCommands(join(directory, 'absent'), processes)).toEqual([]);
});

test('a start is one of the three kinds', () => {
  expect(['heavy', 'setup', 'thread'].every(isStartKind)).toBe(true);
  expect([undefined, 'build', 'toString', ''].some(isStartKind)).toBe(false);
});
