import { afterEach, expect, test } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hasFlock, type HeldLock } from './heavy-slot';
import type { Admission } from './machine-room';
import { claimSetupTurn, waitForSetupTurn } from './setup-turn';

const directories: string[] = [];
const processes: ChildProcess[] = [];
const turns: Pick<HeldLock, 'release'>[] = [];
afterEach(() => {
  for (const turn of turns.splice(0)) turn.release();
  for (const child of processes.splice(0)) child.kill('SIGKILL');
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function turnDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'werkflow-setup-turn-'));
  directories.push(directory);
  return join(directory, 'nested');
}

const ADMITTED: Admission = { admitted: true, measured: true, unwatched: false, reason: 'room' };
const refused = (reason: string): Admission => ({
  admitted: false,
  measured: false,
  unwatched: false,
  reason,
});
const TAKEN = "Another worktree's setup has this machine's one setup turn. This one installs after it.";

/**
 * A wait whose clock starts at 02:00 and moves only when it sleeps. `claims` are the answers of
 * the turn, in order (false: another setup holds it); `verdicts` the machine's, then admitted.
 */
function waiting(claims: boolean[], verdicts: Admission[]) {
  const start = Date.UTC(2026, 10, 12, 2, 0);
  let clock = start;
  const announced: [number, string | undefined, number | undefined][] = [];
  const asked: number[] = [];
  let released = 0;
  const done = waitForSetupTurn({
    claim: () => Promise.resolve((claims.shift() ?? true) ? { release: () => void (released += 1) } : null),
    admission: () => {
      asked.push((clock - start) / 60_000);
      return verdicts.shift() ?? ADMITTED;
    },
    announce: (text) =>
      announced.push([(clock - start) / 60_000, text?.reason, text && (text.since - start) / 60_000]),
    sleep: (milliseconds) => {
      clock += milliseconds;
      return Promise.resolve();
    },
    now: () => clock,
  });
  return { done, announced, asked, released: () => released };
}

test('a setup on a machine with room installs at once and announces nothing', async () => {
  const { done, announced, released } = waiting([], []);
  const { verdict, turn } = await done;
  expect(verdict).toEqual(ADMITTED);
  expect(announced).toEqual([]);
  // The caller gives the turn back after its install.
  expect(released()).toBe(0);
  turn.release();
  expect(released()).toBe(1);
});

test('a waiting setup says why at once and every five minutes, always with the moment its wait began', async () => {
  const blocked = refused(
    'This machine takes no start now: the 5-minute load is 40.0 on 14 cores, above 35.0.',
  );
  const short = refused(
    '1.6 GiB of room (5.6 available, 4.0 still reserved, 1 heavy command running); it needs 1.7.',
  );
  // Polled every 30 s: blocked for 11 minutes, then short of room for one poll, then admitted.
  const { done, announced } = waiting([], [...Array.from({ length: 22 }, () => blocked), short]);
  expect((await done).verdict).toEqual(ADMITTED);
  expect(announced).toEqual([
    [0, blocked.reason, 0],
    [5, blocked.reason, 0],
    [10, blocked.reason, 0],
    [11.5, undefined, undefined],
  ]);
});

test('one setup at a time: a second setup waits for the turn, and asks for room only once it holds it', async () => {
  const { done, announced, asked } = waiting([false, false, false], [refused('no room yet')]);
  expect((await done).verdict).toEqual(ADMITTED);
  // Three polls without the turn, then one with the turn and no room, then admitted. The turn is kept meanwhile.
  expect(asked).toEqual([1.5, 2]);
  expect(announced).toEqual([
    [0, TAKEN, 0],
    [1.5, 'no room yet', 0],
    [2, undefined, undefined],
  ]);
});

test('a machine without flock has no setup turns: every setup installs', async () => {
  const directory = turnDirectory();
  const first = await claimSetupTurn(directory, process.pid, () => false);
  const second = await claimSetupTurn(directory, process.pid, () => false);
  expect([first, second].every((turn) => turn !== null)).toBe(true);
  first?.release();
});

// The turn is a util-linux flock lock; a machine without flock has no turns, as the test above proves.
if (hasFlock()) {
  /** A process that runs until it is killed: another worktree's setup in a test. */
  const otherSetup = (): ChildProcess & { pid: number } => {
    const child = spawn('cat', [], { stdio: ['pipe', 'ignore', 'ignore'] });
    processes.push(child);
    if (child.pid === undefined) throw new Error('cat did not start.');
    return Object.assign(child, { pid: child.pid });
  };

  test('the turn is held by one setup, and freed on release', async () => {
    const directory = turnDirectory();
    const first = await claimSetupTurn(directory, otherSetup().pid);
    if (!first || !('released' in first)) throw new Error('The first setup did not get the turn.');
    turns.push(first);
    expect(await claimSetupTurn(directory, process.pid)).toBeNull();
    first.release();
    await first.released;
    const second = await claimSetupTurn(directory, process.pid);
    expect(second).not.toBeNull();
    if (second) turns.push(second);
  });

  // No holder can be stale, so no setup ever has to judge and remove another's turn:
  // two waiters cannot both take over a dead one (the kernel gives the lock to one).
  test('a killed setup frees the turn by itself, and of two waiters exactly one gets it', async () => {
    const directory = turnDirectory();
    const killed = otherSetup();
    const first = await claimSetupTurn(directory, killed.pid);
    if (!first || !('released' in first)) throw new Error('The first setup did not get the turn.');
    killed.kill('SIGKILL');
    await first.released;
    const claims = await Promise.all([
      claimSetupTurn(directory, otherSetup().pid),
      claimSetupTurn(directory, otherSetup().pid),
    ]);
    for (const claim of claims) if (claim) turns.push(claim);
    expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
  });
}
