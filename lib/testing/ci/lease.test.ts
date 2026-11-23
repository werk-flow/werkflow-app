// Two local machines never both own one head, and only the attempt that holds the head's lease ref
// marks its verdict (decision 0011, rule 3). The fake ref store swaps atomically, as
// `git push --force-with-lease` does on GitHub.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  claim,
  formatLease,
  heartbeat,
  LEASE_MARGIN_S,
  type LeaseRefs,
  markDone,
  nextGeneration,
  parseLease,
  release,
} from './lease';

const SHA = 'a'.repeat(40);
const TTL = 600;
const me = (machine: string, attempt = 1, approval = false) => ({
  machine,
  generation: 1,
  attempt,
  approval,
});

/** GitHub's refs: one value per head, swapped only from the value a writer expects. */
function fakeRefs() {
  const values = new Map<string, { oid: string; message: string }>();
  let next = 1;
  const refs: LeaseRefs = {
    read: async (sha) => values.get(sha) ?? null,
    swap: async (sha, expected, message) => {
      // Another writer may act between a read and this push: the push compares atomically.
      await Promise.resolve();
      if ((values.get(sha)?.oid ?? null) !== expected) return null;
      const value = { oid: `oid${next++}`, message };
      values.set(sha, value);
      return value;
    },
    remove: async (sha, expected) => values.get(sha)?.oid === expected && values.delete(sha),
  };
  return { refs, values };
}

test('two machines claiming one head at once: exactly one wins, and the loser leaves nothing behind', async () => {
  const { refs, values } = fakeRefs();
  const results = await Promise.all([
    claim(refs, SHA, me('mac'), 1_000, TTL),
    claim(refs, SHA, me('pc'), 1_000, TTL),
  ]);
  expect(results.filter((result) => result.claimed)).toHaveLength(1);
  expect(
    results.filter((result) => !result.claimed).map((result) => !result.claimed && result.reason),
  ).toEqual(['lost-race']);
  expect(values.size).toBe(1);
});

test('a held lease is taken over only past its expiry plus the margin, and an expired lease is never renewed', async () => {
  const { refs } = fakeRefs();
  const first = await claim(refs, SHA, me('mac'), 1_000, TTL);
  if (!first.claimed) throw new Error('the first claim must win');
  expect(await claim(refs, SHA, me('pc'), 1_000 + TTL + LEASE_MARGIN_S, TTL)).toEqual({
    claimed: false,
    reason: 'held',
  });
  const taken = await claim(refs, SHA, me('pc'), 1_000 + TTL + LEASE_MARGIN_S + 1, TTL);
  expect(taken.claimed).toBe(true);
  // The old owner's clock says expired: it renews nothing, and a swap from its old value fails anyway.
  expect(await heartbeat(refs, SHA, first.held, 1_000 + TTL + 1, TTL)).toBe('lost');
  expect(await heartbeat(refs, SHA, first.held, 1_000 + 10, TTL)).toBe('lost');
});

test("a dead owner's late verdict is stale: its done swap fails once another attempt holds the ref", async () => {
  const { refs } = fakeRefs();
  const dead = await claim(refs, SHA, me('mac'), 1_000, TTL);
  if (!dead.claimed) throw new Error('the first claim must win');
  const next = await claim(refs, SHA, me('pc'), 1_000 + TTL + LEASE_MARGIN_S + 1, TTL);
  if (!next.claimed) throw new Error('the takeover must win');
  expect(await markDone(refs, SHA, dead.held, 1_100)).toBe('stale');
  expect(await markDone(refs, SHA, next.held, 1_000 + TTL + LEASE_MARGIN_S + 2)).not.toBe('stale');
});

test("a verdict is refused within the margin of its own expiry by the poster's clock", async () => {
  const { refs } = fakeRefs();
  const held = await claim(refs, SHA, me('mac'), 1_000, TTL);
  if (!held.claimed) throw new Error('the claim must win');
  expect(await markDone(refs, SHA, held.held, 1_000 + TTL - LEASE_MARGIN_S)).toBe('stale');
});

test('a done head is not claimed again under the same approval, and is under a changed one', async () => {
  const { refs } = fakeRefs();
  const held = await claim(refs, SHA, me('mac'), 1_000, TTL);
  if (!held.claimed) throw new Error('the claim must win');
  await markDone(refs, SHA, held.held, 1_010);
  expect(await claim(refs, SHA, me('pc', 2), 1_020, TTL)).toEqual({ claimed: false, reason: 'verdict' });
  expect((await claim(refs, SHA, me('pc', 2, true), 1_020, TTL)).claimed).toBe(true);
});

test('a released head is claimable at once; a ref that holds no lease is never taken over', async () => {
  const { refs, values } = fakeRefs();
  const held = await claim(refs, SHA, me('mac'), 1_000, TTL);
  if (!held.claimed) throw new Error('the claim must win');
  expect(await release(refs, SHA, held.held)).toBe(true);
  expect((await claim(refs, SHA, me('pc'), 1_001, TTL)).claimed).toBe(true);
  values.set(SHA, { oid: 'hand', message: 'made by hand' });
  expect(await claim(refs, SHA, me('mac', 3), 99_999, TTL)).toEqual({ claimed: false, reason: 'foreign' });
});

test('the lease message round-trips and refuses a machine id that is no id', () => {
  const lease = {
    machine: 'pc',
    generation: 3,
    attempt: 17,
    expiresAt: 1_795_000_000,
    state: 'held' as const,
    approval: true,
  };
  expect(parseLease(formatLease(lease))).toEqual(lease);
  expect(parseLease('lease:v1 m=pc g=3 exp=1')).toBeUndefined();
  expect(() => formatLease({ ...lease, machine: 'PC 1' })).toThrow();
});

let directory = '';
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'ci-lease-'));
});
afterEach(() => {
  chmodSync(directory, 0o700);
  rmSync(directory, { recursive: true, force: true });
});

test('generations rise monotonically and never repeat after a crash between read and rename', () => {
  const file = join(directory, 'generation');
  const returned = [nextGeneration(file), nextGeneration(file)];
  // A crash after the temp file was written but before the rename: the read-only directory refuses it.
  writeFileSync(`${file}.${process.pid}.tmp`, '999\n');
  chmodSync(directory, 0o500);
  expect(() => nextGeneration(file), 'a write that cannot finish returns no generation').toThrow();
  chmodSync(directory, 0o700);
  returned.push(nextGeneration(file), nextGeneration(file));
  expect(returned).toEqual([1, 2, 3, 4]);
});

test('a generation file that holds no generation fails loudly instead of restarting at one', () => {
  const file = join(directory, 'generation');
  for (const text of ['', 'zwei\n', '-1\n', '1.5\n']) {
    writeFileSync(file, text);
    expect(() => nextGeneration(file), JSON.stringify(text)).toThrow();
  }
});
