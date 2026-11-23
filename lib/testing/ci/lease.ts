// The machine claim (decision 0011, rule 3): a local machine owns a head's run through one Git ref on
// GitHub, `refs/leases/ci/<sha>`, the only channel the machines share. GitHub's check runs have no
// compare-and-swap; a ref push with `--force-with-lease` does, as the workspace's other leases use
// it (docs/technical/machine-setup.md, "Background jobs"). The ref points at an empty commit whose
// message is the lease: `lease:v1 m=<machine> g=<generation> attempt=<n> exp=<epoch s>
// state=<held|done|released> approval=<0|1>`.
//   - Claim: create the ref where it is absent, or swap it from a value that lets go: a held lease
//     past its `exp` plus the margin, a released one, or a done one of another approval.
//   - Heartbeat: swap from the value last read to a new `exp`; an expired lease is never renewed.
//   - Verdict: swap to `done` first; only then is the attempt's own `Check` check run completed.
//   - Release: swap to `released`; the check run then completes as cancelled.
// The App's `Check` check run stays the visible status and the verdict, never the owner.
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

type LeaseState = 'held' | 'done' | 'released';

export type Lease = {
  machine: string;
  generation: number;
  attempt: number;
  expiresAt: number;
  state: LeaseState;
  /** The owner's `approved: list growth` as the run saw it: a done lease of another approval lets go. */
  approval: boolean;
};

/** A lease this machine holds: the lease and the ref's commit it last wrote. */
export type HeldLease = { oid: string; lease: Lease };

/** The head's lease ref as read: its commit and that commit's message. */
export type RefValue = { oid: string; message: string };

/** Every GitHub call the lease makes. */
export interface LeaseRefs {
  /** The head's lease ref, or null when it is absent. */
  read(sha: string): Promise<RefValue | null>;
  /**
   * Points the head's lease ref at a new commit with `message`, only while it is `expected` (null:
   * absent), in one atomic push. The new value, or null when the ref was another. `deadlineMs` bounds
   * the push and the read that settles an answer it lost; past it the swap throws.
   */
  swap(sha: string, expected: string | null, message: string, deadlineMs?: number): Promise<RefValue | null>;
  /** Deletes the head's lease ref, only while it is `expected`. */
  remove(sha: string, expected: string): Promise<boolean>;
}

export type ClaimResult =
  | { claimed: true; held: HeldLease }
  | { claimed: false; reason: 'held' | 'foreign' | 'verdict' | 'lost-race' };

/** Seconds by which a machine distrusts an expiry, against clock skew between the machines. */
export const LEASE_MARGIN_S = 60;
/** The least time a verdict's swap to `done` may take, with the read that settles a lost answer. */
const DONE_SWAP_MIN_MS = 30_000;

const MACHINE = /^[a-z0-9-]{1,20}$/;
const COUNT = '(0|[1-9][0-9]{0,15})';
const LEASE_MESSAGE = new RegExp(
  `^lease:v1 m=([a-z0-9-]{1,20}) g=${COUNT} attempt=${COUNT} exp=${COUNT} state=(held|done|released) approval=([01])\\s*$`,
);
const STATES: readonly LeaseState[] = ['held', 'done', 'released'];

export function formatLease(lease: Lease): string {
  if (!MACHINE.test(lease.machine)) throw new Error(`lease machine id must match ${MACHINE}`);
  for (const value of [lease.generation, lease.attempt, lease.expiresAt])
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error('lease generation, attempt and expiry must be non-negative safe integers');
  return `lease:v1 m=${lease.machine} g=${lease.generation} attempt=${lease.attempt} exp=${lease.expiresAt} state=${lease.state} approval=${lease.approval ? 1 : 0}`;
}

export function parseLease(message: string): Lease | undefined {
  const match = LEASE_MESSAGE.exec(message);
  if (match === null) return undefined;
  const [, machine, generation, attempt, expiresAt, state, approval] = match;
  const known = STATES.find((candidate) => candidate === state);
  if (machine === undefined || known === undefined) return undefined;
  const lease = {
    machine,
    generation: Number(generation),
    attempt: Number(attempt),
    expiresAt: Number(expiresAt),
    state: known,
    approval: approval === '1',
  };
  return [lease.generation, lease.attempt, lease.expiresAt].every(Number.isSafeInteger) ? lease : undefined;
}

/**
 * Claims the head for `me` (`now` is this machine's epoch seconds): creates the ref where it is
 * absent, or takes it over from a value that lets go. A ref whose message is no lease is never taken.
 */
export async function claim(
  refs: LeaseRefs,
  sha: string,
  me: Pick<Lease, 'machine' | 'generation' | 'attempt' | 'approval'>,
  now: number,
  ttlS: number,
): Promise<ClaimResult> {
  const current = await refs.read(sha);
  if (current !== null) {
    const lease = parseLease(current.message);
    if (lease === undefined) return { claimed: false, reason: 'foreign' };
    if (lease.state === 'held' && now <= lease.expiresAt + LEASE_MARGIN_S)
      return { claimed: false, reason: 'held' };
    if (lease.state === 'done' && lease.approval === me.approval)
      return { claimed: false, reason: 'verdict' };
  }
  const lease: Lease = { ...me, expiresAt: now + ttlS, state: 'held' };
  const swapped = await refs.swap(sha, current?.oid ?? null, formatLease(lease));
  return swapped === null
    ? { claimed: false, reason: 'lost-race' }
    : { claimed: true, held: { oid: swapped.oid, lease } };
}

/** Renews the lease from the value this machine wrote last; `lost` once it expired or another value took its place. */
export async function heartbeat(
  refs: LeaseRefs,
  sha: string,
  held: HeldLease,
  now: number,
  ttlS: number,
): Promise<HeldLease | 'lost'> {
  if (now > held.lease.expiresAt) return 'lost';
  const lease = { ...held.lease, expiresAt: now + ttlS };
  const swapped = await refs.swap(sha, held.oid, formatLease(lease));
  return swapped === null ? 'lost' : { oid: swapped.oid, lease };
}

/**
 * Marks the attempt's verdict as the head's, only while this lease is the ref's value and stays valid
 * past `now` plus the margin; the caller completes the check run only after `done`. `stale` otherwise.
 */
export async function markDone(
  refs: LeaseRefs,
  sha: string,
  held: HeldLease,
  now: number,
): Promise<HeldLease | 'stale'> {
  // The swap and its recovery from a lost answer must end while the lease still holds, by this
  // machine's clock less the margin; with less time left the caller releases instead.
  const leftMs = (held.lease.expiresAt - LEASE_MARGIN_S - now) * 1_000;
  if (leftMs < DONE_SWAP_MIN_MS) return 'stale';
  const lease: Lease = { ...held.lease, state: 'done' };
  const swapped = await refs.swap(sha, held.oid, formatLease(lease), leftMs);
  return swapped === null ? 'stale' : { oid: swapped.oid, lease };
}

/** Hands the head back: `released` while this lease is still the ref's value; false when another took it. */
export async function release(refs: LeaseRefs, sha: string, held: HeldLease): Promise<boolean> {
  return (await refs.swap(sha, held.oid, formatLease({ ...held.lease, state: 'released' }))) !== null;
}

/** Whether `value` is a lease of this exact attempt. */

/** Writes `file` whole or not at all, durably: temp file, fsync, rename, folder fsync. */
export function writeDurably(file: string, text: string): void {
  const temp = `${file}.${process.pid}.tmp`;
  const handle = openSync(temp, 'w');
  try {
    writeSync(handle, text);
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  renameSync(temp, file);
  const directory = openSync(dirname(file), 'r');
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}

function readGeneration(file: string): number {
  let text: string;
  try {
    text = readFileSync(file, 'utf8').trim();
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return 0;
    throw error;
  }
  const value = Number(text);
  if (!/^(0|[1-9][0-9]*)$/.test(text) || !Number.isSafeInteger(value))
    throw new Error(`generation file ${file} holds no generation`);
  return value;
}

/**
 * The next number of a durable counter: this machine's generations, or its attempts. It is durable
 * before it is returned (temp file, fsync, rename, directory fsync), so a crash anywhere in between
 * returns nothing and never reuses one.
 */
export function nextGeneration(file: string): number {
  const next = readGeneration(file) + 1;
  writeDurably(file, `${next}\n`);
  return next;
}
