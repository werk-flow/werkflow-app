import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type Admission,
  admission,
  isStartKind,
  processTable,
  readMachineRoom,
  runningHeavyCommands,
  type RoomReading,
  type StartKind,
  waitForAdmission,
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

// A quiet PC: 15-minute load 2 on 14 cores, under the watch's normal line of 1.5 per core.
const watched = (
  available: number,
  floor: number,
  blocked: string | null = null,
  load = { load: 2, cores: 14, normalLoad: 21 },
): RoomReading => ({
  room: { available: available * GIB, floor: floor * GIB, blocked, alerted: false, ...load },
});
const UNWATCHED: RoomReading = { unwatched: 'no load watch at /nowhere', fix: 'Install the load watch.' };
const admitted = (start: StartKind, reading: RoomReading, heavy: readonly number[] = []): boolean =>
  admission(
    start,
    reading,
    heavy.map((use) => use * GIB),
  ).admitted;

// The watch sets the floor at 10 % of RAM and raises it to 20 % while its alert is open or swap fills
// (werk-flow/werkflow-planning ops/workstation-load.py). The costs are this module's: 4, 0.1, 0.5 and 3.5 GiB.
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
    expect([machine, admitted('device', at(floor + 3.51))]).toEqual([machine, true]);
    expect([machine, admitted('device', at(floor + 3.49))]).toEqual([machine, false]);
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

test('the overload of 2026-11-13 replayed: no simulator boot on the Mac with 3.1 GB available', () => {
  // werk-flow/werkflow-app#418: the boot took the Mac to load 122 and memory pressure warn.
  const before = admission('device', watched(3.1, 1.8), []);
  expect(before.admitted).toBe(false);
  expect(before.reason).toContain('it needs 5.3: the floor of 1.8 and 3.5 for the device.');
  // A running heavy command's unused reservation counts against a boot, as against a second command.
  expect(admitted('device', watched(9.4, 1.8), [0])).toBe(true);
  expect(admitted('device', watched(9.2, 1.8), [0])).toBe(false);
});

test('a blocked machine takes no start of any kind', () => {
  const blocked = watched(14, 1.56, 'the 5-minute load is 40.0 on 14 cores, above 35.0');
  for (const start of ['heavy', 'setup', 'thread', 'device'] as const) {
    const verdict = admission(start, blocked, []);
    expect(verdict.admitted).toBe(false);
    expect(verdict.reason).toBe(
      'This machine takes no start now: the 5-minute load is 40.0 on 14 cores, above 35.0.',
    );
  }
});

// The watch's normal line is 1.5 per core: 24 on the VM's 16 cores, 16.5 on the Mac's 11.
test('a thread waits for a 15-minute load under the normal line, however much memory is free', () => {
  // 2026-11-14 on the VM: load 29 to 55 on 16 cores all morning, 19 GiB available.
  const vm = (load: number): RoomReading => watched(19, 3.2, null, { load, cores: 16, normalLoad: 24 });
  const busy = admission('thread', vm(29), []);
  expect(busy).toMatchObject({ admitted: false, measured: false, unwatched: false });
  expect(busy.reason).toBe(
    "19.0 GiB available plus 0.0 held by heavy commands (no heavy command runs); a thread needs 7.7: the floor of 3.2, 4.0 for a check:changed and 0.5 for each agent. The 15-minute load is 29.0 on 16 cores; a thread needs it under 24.0, the load watch's normal line.",
  );
  expect(admitted('thread', vm(24))).toBe(false);
  expect(admitted('thread', vm(23.9))).toBe(true);
  // The load line is the thread's alone: a heavy command, a setup and a device keep the memory rule
  // and the watch's own block above 2.5 per core.
  for (const start of ['heavy', 'setup', 'device'] as const) expect(admitted(start, vm(29))).toBe(true);
  // Below the line, memory still decides.
  expect(admitted('thread', watched(7.6, 3.2, null, { load: 10, cores: 16, normalLoad: 24 }))).toBe(false);
});

test('a macOS memory pressure of warn alone refuses nothing; the measured numbers decide', () => {
  // werk-flow/werkflow-app#454: warn, 3.1 of 18 GiB available, load 2.8 on 11 cores, one agent, no
  // heavy command. The floor is 10 % of RAM before the watch's alert opens.
  const mac = (available: number, blocked: string): RoomReading =>
    watched(available, 1.8, blocked, { load: 2.8, cores: 11, normalLoad: 16.5 });
  const warn = mac(3.1, 'macOS reports memory pressure: warn');
  expect(admitted('heavy', warn)).toBe(true);
  expect(admitted('setup', warn)).toBe(true);
  // A thread still needs memory for its agent and its check:changed: 3.1 GiB holds neither, and the
  // refusal names those numbers, never the pressure.
  const thread = admission('thread', warn, []);
  expect(thread.admitted).toBe(false);
  expect(thread.reason).toStartWith('3.1 GiB available plus 0.0 held by heavy commands');
  expect(thread.reason).not.toContain('pressure');
  expect(admitted('thread', mac(6.4, 'macOS reports memory pressure: warn'))).toBe(true);
  // Critical still blocks every start.
  expect(admitted('setup', mac(9, 'macOS reports memory pressure: critical'))).toBe(false);
});

test('a wait for room returns once memory and load both hold', async () => {
  const vm = (available: number, load: number): Admission =>
    admission('thread', watched(available, 3.2, null, { load, cores: 16, normalLoad: 24 }), []);
  // Memory but no load line, then the load line but no memory, then both.
  const verdicts = [vm(19, 30), vm(7, 12), vm(19, 12), vm(2, 40)];
  const waits: string[] = [];
  let measured = 0;
  let pauses = 0;
  const verdict = await waitForAdmission(
    () => {
      const next = verdicts[measured];
      measured += 1;
      if (!next) throw new Error('The wait measured past the admitted verdict.');
      return next;
    },
    (refused) => waits.push(refused.reason),
    async () => {
      pauses += 1;
    },
  );
  expect(verdict.admitted).toBe(true);
  expect([measured, pauses]).toEqual([3, 2]);
  // Only the first refusal is announced.
  expect(waits).toHaveLength(1);
  expect(waits[0]).toContain('The 15-minute load is 30.0 on 16 cores');
  // On a machine without the watch, waiting changes nothing: the wait returns that verdict at once.
  const unwatched = await waitForAdmission(
    () => admission('thread', UNWATCHED, []),
    () => {
      throw new Error('An unwatched machine is no wait.');
    },
    async () => {
      throw new Error('An unwatched machine is no wait.');
    },
  );
  expect(unwatched).toMatchObject({ admitted: false, unwatched: true });
});

test('a machine without the watch keeps a heavy command, a setup and a device going and refuses a thread with the install command', () => {
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
  expect(admission('device', UNWATCHED, [])).toMatchObject({ admitted: true, unwatched: true });
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

const WATCH_SOURCE = 'LOAD_PER_CORE = 2.5\nAVAILABLE_FLOOR = 0.10\nCLEAR_LOAD_PER_CORE = 1.5\n';

function watchAnswering(
  status: number | null,
  stdout: string,
  stderr = '',
  source = WATCH_SOURCE,
): RoomReading {
  const script = join(temporaryDirectory(), 'workstation-load.py');
  writeFileSync(script, source);
  const calls: string[][] = [];
  const reading = readMachineRoom(
    { WERKFLOW_LOAD_WATCH: script },
    (command, args) => {
      calls.push([command, ...args]);
      return { status, stdout, stderr };
    },
    'linux',
    () => ({ load: 17, cores: 14 }),
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
  ).toEqual({
    room: {
      available: 10956226560,
      floor: 1677124812,
      blocked: null,
      alerted: false,
      load: 17,
      cores: 14,
      normalLoad: 21,
    },
  });
  expect(
    watchAnswering(
      0,
      '{"available": 1, "floor": 2, "blocked": "macOS reports memory pressure: warn", "alerted": true, "watching": true}',
    ),
  ).toEqual({
    room: {
      available: 1,
      floor: 2,
      blocked: 'macOS reports memory pressure: warn',
      alerted: true,
      load: 17,
      cores: 14,
      normalLoad: 21,
    },
  });
});

// The normal line is the watch's own constant, never a copy here (werk-flow/werkflow-planning
// ops/workstation-load.py): a watch that names none is an unreadable answer.
test('the normal load line is read from the watch, and a watch without one is no reading', () => {
  const room = '{"available": 1, "floor": 2, "blocked": null, "alerted": false, "watching": true}';
  const withLine = (source: string): RoomReading => watchAnswering(0, room, '', source);
  expect(withLine('CLEAR_LOAD_PER_CORE = 2  # a comment\n')).toMatchObject({ room: { normalLoad: 28 } });
  for (const source of [
    '',
    'LOAD_PER_CORE = 2.5\n',
    'CLEAR_LOAD_PER_CORE = CORES\n',
    '# CLEAR_LOAD_PER_CORE = 1.5\n',
  ])
    expect(withLine(source)).toMatchObject({
      unwatched: expect.stringContaining('names no normal load line'),
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

test('a start is one of the four kinds', () => {
  expect(['heavy', 'setup', 'thread', 'device'].every(isStartKind)).toBe(true);
  expect([undefined, 'build', 'toString', ''].some(isStartKind)).toBe(false);
});
