import { afterEach, expect, test } from 'bun:test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HEAVY_SLOT_VARIABLE, heavySlotSkip, runInSlot, SLOT_TAKEN, slotPath } from './heavy-slot';

const directories: string[] = [];
const holders: ChildProcessWithoutNullStreams[] = [];
afterEach(() => {
  for (const holder of holders.splice(0)) holder.kill('SIGKILL');
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function slotDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'werkflow-heavy-slot-'));
  directories.push(directory);
  return directory;
}

/** Holds `slot` from another process until its stdin closes; resolves once the lock is held. */
function holdSlot(directory: string, slot: number): Promise<ChildProcessWithoutNullStreams> {
  const holder = spawn('flock', [slotPath(directory, slot), 'sh', '-c', 'echo held; cat']);
  holders.push(holder);
  return new Promise((resolveHeld, reject) => {
    holder.on('error', reject);
    holder.stdout.once('data', () => resolveHeld(holder));
  });
}

const exited = (holder: ChildProcessWithoutNullStreams): Promise<void> =>
  new Promise((resolveExit) => holder.once('exit', () => resolveExit()));

test('CI and a command already inside a slot take no slot; a machine without flock warns instead', () => {
  const hasFlock = () => true;
  expect(heavySlotSkip({ CI: 'true' }, hasFlock)).toBe('ci');
  expect(heavySlotSkip({ [HEAVY_SLOT_VARIABLE]: '2' }, hasFlock)).toBe('nested');
  expect(heavySlotSkip({}, () => false)).toBe('no-flock');
  expect(heavySlotSkip({}, hasFlock)).toBeUndefined();
});

test('a held slot refuses a second command, and a free slot runs it with its exit code and slot number', async () => {
  const directory = slotDirectory();
  await holdSlot(directory, 0);
  expect(await runInSlot(directory, 0, ['true'], process.env)).toBe(SLOT_TAKEN);
  expect(await runInSlot(directory, 1, ['sh', '-c', 'exit 3'], process.env)).toBe(3);
  expect(await runInSlot(directory, 1, ['sh', '-c', `test "$${HEAVY_SLOT_VARIABLE}" = 1`], process.env)).toBe(
    0,
  );
});

test('a slot frees when its holder ends, also when the holder is killed', async () => {
  const directory = slotDirectory();
  const finishing = await holdSlot(directory, 0);
  const killed = await holdSlot(directory, 1);
  finishing.stdin.end();
  killed.kill('SIGKILL');
  await Promise.all([exited(finishing), exited(killed)]);
  expect(await runInSlot(directory, 0, ['true'], process.env)).toBe(0);
  expect(await runInSlot(directory, 1, ['true'], process.env)).toBe(0);
});
