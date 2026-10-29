import { afterEach, expect, test } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { HEAVY_SLOT_VARIABLE, hasFlock, heavySlotSkip, tryHeavySlot, type HeavySlot } from './heavy-slot';

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

test('CI and a command already inside a slot take no slot; a machine without flock warns instead', () => {
  const available = () => true;
  expect(heavySlotSkip({ CI: 'true' }, available)).toBe('ci');
  expect(heavySlotSkip({ [HEAVY_SLOT_VARIABLE]: '2' }, available)).toBe('nested');
  expect(heavySlotSkip({}, () => false)).toBe('no-flock');
  expect(heavySlotSkip({}, available)).toBeUndefined();
});

// The slots are util-linux flock locks; without flock (macOS) the limit is off, as the test above proves.
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
    released.release();
    killedOwner.child.kill('SIGKILL');
    await Promise.all([released.released, orphaned.released]);
    expect((await held(directory, 0, process.pid)).slot).toBe(0);
    expect((await held(directory, 1, process.pid)).slot).toBe(1);
  });

  // A heavy script keeps its own exit code and signal handlers: the slot never reruns or wraps it.
  test('a script in a slot keeps its exit code, also 197, and runs its own SIGTERM cleanup', async () => {
    const directory = slotDirectory();
    const slotModule = JSON.stringify(resolve(import.meta.dir, 'heavy-slot.ts'));
    const script = (body: string) => {
      const child = spawn(
        process.execPath,
        ['-e', `const { acquireHeavySlot } = await import(${slotModule});\n${body}`],
        {
          env: { ...process.env, CI: '', [HEAVY_SLOT_VARIABLE]: '', WERKFLOW_HEAVY_SLOT_DIR: directory },
          stdio: ['ignore', 'pipe', 'inherit'],
        },
      );
      processes.push(child);
      return child;
    };

    expect(await exited(script("await acquireHeavySlot('exit test'); process.exit(197);"))).toBe(197);

    const cancelled = script(
      "await acquireHeavySlot('signal test'); process.on('SIGTERM', () => { console.log('cleaned'); process.exit(0); }); console.log('ready'); setInterval(() => {}, 1000);",
    );
    let output = '';
    await new Promise<void>((resolveReady) =>
      cancelled.stdout?.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes('ready')) resolveReady();
      }),
    );
    cancelled.kill('SIGTERM');
    expect(await exited(cancelled)).toBe(0);
    expect(output).toContain('cleaned');
  });
}
