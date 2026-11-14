import { afterEach, expect, test } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import {
  HEAVY_SLOT_VARIABLE,
  hasFlock,
  heavySlotCount,
  heavySlotSkip,
  offeredHeavySlots,
  tryHeavySlot,
  type HeavySlot,
} from './heavy-slot';
import type { RoomReading } from './machine-room';

const GIB = 1024 ** 3;

const directories: string[] = [];
const processes: ChildProcess[] = [];
const slots: HeavySlot[] = [];
afterEach(() => {
  for (const slot of slots.splice(0)) slot.release();
  for (const child of processes.splice(0)) child.kill('SIGKILL');
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function slotDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'werkflow-heavy-slot-'));
  directories.push(directory);
  return directory;
}

/** A process that runs until it is killed: a slot's owner in a test. */
function owner(): { pid: number; child: ChildProcess } {
  const child = spawn('cat', [], { stdio: ['pipe', 'ignore', 'ignore'] });
  processes.push(child);
  if (child.pid === undefined) throw new Error('cat did not start.');
  return { pid: child.pid, child };
}

async function held(directory: string, slot: number, ownerPid: number): Promise<HeavySlot> {
  const taken = await tryHeavySlot(directory, slot, ownerPid);
  if (!taken) throw new Error(`Heavy slot ${slot} was taken.`);
  slots.push(taken);
  return taken;
}

const exited = (child: ChildProcess): Promise<number | null> =>
  new Promise((resolveExit) => child.once('exit', resolveExit));

test('CI and a command already inside a slot take no slot; a machine without flock is told apart', () => {
  const available = () => true;
  expect(heavySlotSkip({ CI: 'true' }, available)).toBe('ci');
  expect(heavySlotSkip({ [HEAVY_SLOT_VARIABLE]: '2' }, available)).toBe('nested');
  expect(heavySlotSkip({}, () => false)).toBe('no-flock');
  expect(heavySlotSkip({}, available)).toBeUndefined();
});

test('a machine holds as many heavy slots as its memory fits: two on the 16 GB PC, three on the 18 GB Mac, never none', () => {
  const mebibytes = 1024 ** 2;
  const gibibytes = 1024 ** 3;
  // `free -m` total of the PC's WSL machine, where three slots of type-aware eslint stalled it.
  expect(heavySlotCount(15_994 * mebibytes)).toBe(2);
  expect(heavySlotCount(18 * gibibytes)).toBe(3);
  expect(heavySlotCount(32 * gibibytes)).toBe(6);
  expect(heavySlotCount(8 * gibibytes)).toBe(1);
});

const pcRoom = (available: number, blocked: string | null = null): RoomReading => ({
  room: {
    available: available * GIB,
    floor: 1.56 * GIB,
    blocked,
    alerted: false,
    load: 2,
    cores: 14,
    normalLoad: 21,
  },
});

// The count from total memory never saw what the agents held (2026-11-11); it stays only as the upper limit.
test('a machine offers heavy slots by its measured room, up to its count', () => {
  // Room for a further command: every slot up to the count.
  expect(offeredHeavySlots(pcRoom(10), [0], 2).slots).toEqual([0, 1]);
  expect(offeredHeavySlots(pcRoom(10), [], 2).slots).toEqual([0, 1]);
  // 9.1 GiB beside one running command is 5.1 of room, under the 5.56 a second one needs.
  expect(offeredHeavySlots(pcRoom(9.1), [0], 2)).toMatchObject({ slots: [], admitted: false });
  // The count still caps a machine with room to spare.
  expect(offeredHeavySlots(pcRoom(15), [4 * GIB, 4 * GIB], 2).slots).toEqual([0, 1]);
  expect(
    offeredHeavySlots(pcRoom(10, 'the 5-minute load is 40.0 on 14 cores, above 35.0'), [], 2).slots,
  ).toEqual([]);
});

test('the only heavy command without measured room may take slot 0 alone', () => {
  // Two commands that start together both see "no heavy command runs": one slot means one of them waits.
  const offer = offeredHeavySlots(pcRoom(3), [], 2);
  expect(offer).toMatchObject({ slots: [0], admitted: true, measured: false });
  expect(offer.reason).toContain('It is the only heavy command, so it runs without measured room.');
});

test('a machine without the load watch keeps the count from total memory as its only limit', () => {
  const unwatched: RoomReading = { unwatched: 'no load watch at /nowhere', fix: 'Install the load watch.' };
  expect(offeredHeavySlots(unwatched, [], 3)).toMatchObject({ slots: [0, 1, 2], unwatched: true });
});

/** A fresh process's exit code and stderr. */
async function finished(child: ChildProcess): Promise<{ code: number | null; errors: string }> {
  let errors = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    errors += chunk.toString();
  });
  return { code: await exited(child), errors };
}

// Without flock nothing would limit the command, so it does not start (it used to warn and run).
test('a heavy command on a machine without flock is refused with the install command', async () => {
  const emptyPath = slotDirectory();
  const slotModule = JSON.stringify(resolve(import.meta.dir, 'heavy-slot.ts'));
  const child = spawn(
    process.execPath,
    [
      '-e',
      `const { acquireHeavySlot } = await import(${slotModule});\nawait acquireHeavySlot('no flock'); console.log('started');`,
    ],
    {
      env: {
        ...process.env,
        CI: '',
        [HEAVY_SLOT_VARIABLE]: '',
        PATH: emptyPath,
        WERKFLOW_HEAVY_SLOT_DIR: slotDirectory(),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  processes.push(child);
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  const { code, errors } = await finished(child);
  expect(code).not.toBe(0);
  expect(output).not.toContain('started');
  expect(errors).toContain('Refused: flock is missing');
  expect(errors).toContain('brew install flock');
});

// The slots are util-linux flock locks; a machine without flock runs no heavy command, as the test above proves.
if (hasFlock()) {
  test('a held slot is refused to another owner and the other slots stay free', async () => {
    const directory = slotDirectory();
    await held(directory, 0, owner().pid);
    expect(await tryHeavySlot(directory, 0, process.pid)).toBeNull();
    expect((await held(directory, 1, process.pid)).slot).toBe(1);
  });

  test('a slot frees on release and when its owner is killed', async () => {
    const directory = slotDirectory();
    const released = await held(directory, 0, process.pid);
    const killedOwner = owner();
    const orphaned = await held(directory, 1, killedOwner.pid);
    // While held, the slot file names its owner, so the room can count what that command still reserves.
    expect(readFileSync(join(directory, 'slot-0'), 'utf8')).toBe(`${process.pid}\n`);
    expect(readFileSync(join(directory, 'slot-1'), 'utf8')).toBe(`${killedOwner.pid}\n`);
    released.release();
    expect(readFileSync(join(directory, 'slot-0'), 'utf8')).toBe('');
    killedOwner.child.kill('SIGKILL');
    await Promise.all([released.released, orphaned.released]);
    expect((await held(directory, 0, process.pid)).slot).toBe(0);
    expect((await held(directory, 1, process.pid)).slot).toBe(1);
  });

  /** Runs `body` in a fresh process with `acquireHeavySlot` in scope and the slots under `directory`. */
  const slotScript = (directory: string, body: string): ChildProcess => {
    const slotModule = JSON.stringify(resolve(import.meta.dir, 'heavy-slot.ts'));
    const child = spawn(
      process.execPath,
      ['-e', `const { acquireHeavySlot } = await import(${slotModule});\n${body}`],
      {
        // No load watch, whatever machine the test runs on: the count from total memory is the limit.
        env: {
          ...process.env,
          CI: '',
          [HEAVY_SLOT_VARIABLE]: '',
          WERKFLOW_HEAVY_SLOT_DIR: directory,
          WERKFLOW_LOAD_WATCH: join(directory, 'no-watch.py'),
        },
        stdio: ['ignore', 'pipe', 'inherit'],
      },
    );
    processes.push(child);
    return child;
  };

  /** Resolves with the output so far once `child` has printed `text`. */
  const printed = (child: ChildProcess, text: string): Promise<string> => {
    let output = '';
    return new Promise((resolvePrinted) =>
      child.stdout?.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes(text)) resolvePrinted(output);
      }),
    );
  };

  // A heavy script keeps its own exit code and signal handlers: the slot never reruns or wraps it.
  test('a script in a slot keeps its exit code, also 197, and runs its own SIGTERM cleanup', async () => {
    const directory = slotDirectory();
    expect(
      await exited(slotScript(directory, "await acquireHeavySlot('exit test'); process.exit(197);")),
    ).toBe(197);

    const cancelled = slotScript(
      directory,
      "await acquireHeavySlot('signal test'); process.on('SIGTERM', () => { console.log('cleaned'); process.exit(0); }); console.log('ready'); setInterval(() => {}, 1000);",
    );
    const ready = printed(cancelled, 'ready');
    await ready;
    const cleaned = printed(cancelled, 'cleaned');
    cancelled.kill('SIGTERM');
    expect(await exited(cancelled)).toBe(0);
    expect(await cleaned).toContain('cleaned');
  });

  test('an aborted signal ends the wait for a slot while every slot is busy', async () => {
    const directory = slotDirectory();
    // Every slot this machine's runner uses: its count follows memory.
    for (let slot = 0; slot < heavySlotCount(totalmem()); slot += 1) await held(directory, slot, owner().pid);
    const waiting = slotScript(
      directory,
      "const stop = new AbortController(); process.on('SIGTERM', () => stop.abort(new Error('stopped'))); try { await acquireHeavySlot('abort test', stop.signal); } catch (error) { console.log(`aborted: ${error.message}`); process.exit(3); }",
    );
    await printed(waiting, 'abort test waits');
    const aborted = printed(waiting, 'aborted: stopped');
    waiting.kill('SIGTERM');
    expect(await exited(waiting)).toBe(3);
    expect(await aborted).toContain('aborted: stopped');
  });
}
