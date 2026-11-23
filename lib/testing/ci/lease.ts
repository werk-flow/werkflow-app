// The machine claim (decision 0011, rule 3): a local machine owns a head's run through the CI App's
// `Check` check run on that head, the only channel the machines share. The claim is the run's start
// (`publish-check start`, a queued `Check`); its output title carries the lease
// (`lease:v1 m=<machine> g=<generation> exp=<epoch s>`), because `external_id` stays the run's
// identity, which `finishCheckRun` matches. GitHub numbers check runs in creation order, so the newest
// App `Check` is one fact every machine reads alike:
//   - completed: the head has its verdict, and nobody claims it;
//   - queued with a lease: that lease holds the head until its `exp` plus the margin;
//   - queued without one (a start from another scheduler, a hand-made run): nobody may take it over.
// A claimer creates its start, waits the settle delay and proceeds only while its start is the newest.
// A run whose start is no longer the newest stops at its next heartbeat, and `finishCheckRun` refuses
// its verdict.
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

export type Lease = { machine: string; generation: number; expiresAt: number };

/** A lease this machine holds: the lease and the id of the `Check` check run that carries it. */
export type HeldLease = { checkRun: number; lease: Lease };

/** One App `Check` check run on a head, as the lease reads it. */
export type LeaseCheckRun = { id: number; completed: boolean; title: string | null };

/** Every GitHub call the lease makes, so its storage can change behind it. */
export interface LeaseApi {
  /** The configured App's `Check` check runs on the head, completely or not at all, in any order. */
  checkRuns(sha: string): Promise<readonly LeaseCheckRun[]>;
  /** The run's start (`publish-check start`) with this output title; the created check run's id. */
  start(sha: string, title: string): Promise<number>;
  /** Rewrites check run `checkRun`'s output title in place (PATCH); it stays queued. */
  renew(checkRun: number, title: string): Promise<void>;
  /** Waits `ms` milliseconds. */
  wait(ms: number): Promise<void>;
}

export type ClaimResult =
  | { claimed: true; held: HeldLease }
  | { claimed: false; reason: 'held' | 'foreign-pending' | 'verdict' | 'lost-race' };

/** Seconds by which a machine distrusts an expiry, against clock skew between the machines. */
export const LEASE_MARGIN_S = 60;
/** How long a claimer waits after its start before it reads whether it won. */
export const SETTLE_MS = 10_000;
/** The lease title's limit, so it stays one short line in GitHub's checks view. */
export const TITLE_LIMIT = 140;

const MACHINE = /^[a-z0-9-]{1,20}$/;
const LEASE_TITLE =
  /^lease:v1 m=([a-z0-9-]{1,20}) g=(0|[1-9][0-9]{0,15}) exp=(0|[1-9][0-9]{0,15})(?: [\s\S]*)?$/;

function leasePrefix(lease: Lease): string {
  if (!MACHINE.test(lease.machine)) throw new Error(`lease machine id must match ${MACHINE}`);
  for (const value of [lease.generation, lease.expiresAt])
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error('lease generation and expiry must be non-negative safe integers');
  return `lease:v1 m=${lease.machine} g=${lease.generation} exp=${lease.expiresAt}`;
}

/**
 * The lease's title: its prefix, then as many whole characters of the note as fit in 140 UTF-16
 * code units. The note is cut, never the prefix, and no character is split.
 */
export function formatLease(lease: Lease, note: string): string {
  let title = leasePrefix(lease);
  let separator = ' ';
  for (const character of note) {
    if (title.length + separator.length + character.length > TITLE_LIMIT) break;
    title += separator + character;
    separator = '';
  }
  return title;
}

export function parseLease(title: string): Lease | undefined {
  const match = LEASE_TITLE.exec(title);
  if (match === null) return undefined;
  const [, machine, generation, expiresAt] = match;
  if (machine === undefined || generation === undefined || expiresAt === undefined) return undefined;
  const lease = { machine, generation: Number(generation), expiresAt: Number(expiresAt) };
  return Number.isSafeInteger(lease.generation) && Number.isSafeInteger(lease.expiresAt) ? lease : undefined;
}

type Holder =
  | { kind: 'none' }
  | { kind: 'verdict' }
  | { kind: 'foreign-pending' }
  | { kind: 'lease'; checkRun: number; lease: Lease };

async function holderOn(api: LeaseApi, sha: string): Promise<Holder> {
  const newest = (await api.checkRuns(sha)).toSorted((one, other) => other.id - one.id)[0];
  if (newest === undefined) return { kind: 'none' };
  if (newest.completed) return { kind: 'verdict' };
  const lease = newest.title === null ? undefined : parseLease(newest.title);
  return lease === undefined ? { kind: 'foreign-pending' } : { kind: 'lease', checkRun: newest.id, lease };
}

const holds = (holder: Holder, held: HeldLease) =>
  holder.kind === 'lease' &&
  holder.checkRun === held.checkRun &&
  holder.lease.machine === held.lease.machine &&
  holder.lease.generation === held.lease.generation;

const titleOf = (lease: Lease) => formatLease(lease, `Waiting or running on ${lease.machine}`);

/**
 * Claims the head for `me` (`now` is this machine's epoch seconds): refuses a head with a verdict, a
 * start without a lease, or another lease within its `exp` plus the margin; otherwise starts, waits
 * the settle delay and proceeds only while its start is the head's newest `Check`.
 */
export async function claim(
  api: LeaseApi,
  sha: string,
  me: Pick<Lease, 'machine' | 'generation'>,
  now: number,
  ttlS: number,
): Promise<ClaimResult> {
  const before = await holderOn(api, sha);
  if (before.kind === 'verdict' || before.kind === 'foreign-pending')
    return { claimed: false, reason: before.kind };
  if (before.kind === 'lease' && now <= before.lease.expiresAt + LEASE_MARGIN_S)
    return { claimed: false, reason: 'held' };
  const lease = { ...me, expiresAt: now + ttlS };
  const held = { checkRun: await api.start(sha, titleOf(lease)), lease };
  await api.wait(SETTLE_MS);
  return holds(await holderOn(api, sha), held)
    ? { claimed: true, held }
    : { claimed: false, reason: 'lost-race' };
}

/** Renews the lease in place, then returns it while its start is still the newest, else `lost`. */
export async function heartbeat(
  api: LeaseApi,
  sha: string,
  held: HeldLease,
  now: number,
  ttlS: number,
): Promise<HeldLease | 'lost'> {
  const renewed = { checkRun: held.checkRun, lease: { ...held.lease, expiresAt: now + ttlS } };
  await api.renew(held.checkRun, titleOf(renewed.lease));
  return holds(await holderOn(api, sha), renewed) ? renewed : 'lost';
}

/**
 * Posts the run's verdict through `finish` (`finishCheckRun`, which itself refuses a start that is
 * not the newest) only while this lease holds the head and stays valid past `now` plus the margin by
 * this machine's clock. Otherwise it posts nothing: `stale`.
 */
export async function postVerdict(
  api: LeaseApi,
  sha: string,
  held: HeldLease,
  now: number,
  finish: () => Promise<{ id: number } | { problem: string }>,
): Promise<'posted' | 'stale' | { problem: string }> {
  if (!holds(await holderOn(api, sha), held) || now + LEASE_MARGIN_S >= held.lease.expiresAt) return 'stale';
  const finished = await finish();
  return 'problem' in finished ? finished : 'posted';
}

function writeDurably(file: string, text: string): void {
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
 * This machine's next run generation. It is durable before it is returned (temp file, fsync,
 * rename, directory fsync), so a crash anywhere in between returns nothing and never reuses one.
 */
export function nextGeneration(file: string): number {
  const next = readGeneration(file) + 1;
  writeDurably(file, `${next}\n`);
  return next;
}
