// Two local machines never both run one head past a heartbeat, and only the run that holds the head's
// `Check` lease posts its verdict (decision 0011, rule 3).
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  claim,
  formatLease,
  heartbeat,
  type HeldLease,
  LEASE_MARGIN_S,
  type LeaseApi,
  type LeaseCheckRun,
  nextGeneration,
  parseLease,
  postVerdict,
  SETTLE_MS,
  TITLE_LIMIT,
} from './lease';

const SHA = 'a'.repeat(40);
const TTL_S = 600;
const START_S = 1_800_000_000;
const MAC = { machine: 'mac', generation: 1 };
const PC = { machine: 'pc', generation: 1 };
const EXPIRED_AT = START_S + TTL_S + LEASE_MARGIN_S + 1;

/** The App's `Check` check runs on one head; ids rise in creation order, as GitHub numbers them. */
class FakeGitHub implements LeaseApi {
  runs: LeaseCheckRun[] = [];
  waited: number[] = [];
  async checkRuns(): Promise<readonly LeaseCheckRun[]> {
    return this.runs.map((run) => ({ ...run }));
  }
  async start(...[, title]: [string, string]): Promise<number> {
    const id = (this.runs.at(-1)?.id ?? 100) + 1;
    this.runs.push({ id, completed: false, title });
    return id;
  }
  async renew(checkRun: number, title: string): Promise<void> {
    this.runs = this.runs.map((run) => (run.id === checkRun ? { ...run, title } : run));
  }
  async wait(ms: number): Promise<void> {
    this.waited.push(ms);
  }
  /** finishCheckRun's rule: it completes only the head's newest `Check`. */
  finisher(checkRun: number) {
    return async (): Promise<{ id: number } | { problem: string }> => {
      if (this.runs.at(-1)?.id !== checkRun) return { problem: 'a newer run owns Check' };
      this.runs = this.runs.map((run) => (run.id === checkRun ? { ...run, completed: true } : run));
      return { id: checkRun };
    };
  }
  copy(): FakeGitHub {
    const twin = new FakeGitHub();
    twin.runs = this.runs.map((run) => ({ ...run }));
    return twin;
  }
}

type Step = { who: 'A' | 'B'; call: 'read' | 'start' | 'reread' };

/** Every order of A's and B's three GitHub calls (read, start, re-read). */
function interleavings(a: number, b: number): Step[][] {
  const calls = ['read', 'start', 'reread'] as const;
  const step = (who: 'A' | 'B', left: number): Step => ({ who, call: calls[3 - left] ?? 'reread' });
  if (a === 0 && b === 0) return [[]];
  return [
    ...(a > 0 ? interleavings(a - 1, b).map((rest) => [step('A', a), ...rest]) : []),
    ...(b > 0 ? interleavings(a, b - 1).map((rest) => [step('B', b), ...rest]) : []),
  ];
}

/**
 * Whether the settle delay covers the order: a claimer that read before the other's start makes its
 * own start before the other re-reads. The delay makes that true unless a read-to-start gap passes
 * `SETTLE_MS`, the race this module leaves to the heartbeat.
 */
function settled(schedule: readonly Step[]): boolean {
  const at = (who: 'A' | 'B', call: Step['call']) =>
    schedule.findIndex((step) => step.who === who && step.call === call);
  return (['A', 'B'] as const).every((me) => {
    const other = me === 'A' ? 'B' : 'A';
    return !(at(other, 'read') < at(me, 'start') && at(other, 'start') > at(me, 'reread'));
  });
}

/** One claimer's view of the fake: each read or start waits until the schedule releases it. */
class GatedApi implements LeaseApi {
  private waiting: (() => void) | undefined;
  done = false;
  constructor(private readonly github: LeaseApi) {}
  private gate<T>(call: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve) => {
      this.waiting = () => void call().then(resolve);
    });
  }
  checkRuns(sha: string) {
    return this.gate(() => this.github.checkRuns(sha));
  }
  start(sha: string, title: string) {
    return this.gate(() => this.github.start(sha, title));
  }
  renew(checkRun: number, title: string) {
    return this.github.renew(checkRun, title);
  }
  wait(ms: number) {
    return this.github.wait(ms);
  }
  /** Lets the claimer's pending call reach GitHub; a claimer that already returned takes no turn. */
  async release(): Promise<void> {
    for (let turn = 0; this.waiting === undefined && !this.done; turn++) {
      if (turn > 50) throw new Error('the claimer made no GitHub call when its turn came');
      await new Promise((resolve) => setImmediate(resolve));
    }
    const step = this.waiting;
    this.waiting = undefined;
    step?.();
  }
}

async function race(schedule: readonly Step[]) {
  const github = new FakeGitHub();
  const gates = { A: new GatedApi(github), B: new GatedApi(github) };
  const tracked = (gate: GatedApi, me: typeof MAC) =>
    claim(gate, SHA, me, START_S, TTL_S).finally(() => {
      gate.done = true;
    });
  const results = Promise.all([tracked(gates.A, MAC), tracked(gates.B, PC)]);
  for (const step of schedule) await gates[step.who].release();
  const [mac, pc] = await results;
  return { github, claimers: [mac, pc] };
}

test('two machines racing to claim one head proceed exactly once in every order the settle delay covers', async () => {
  const covered = interleavings(3, 3).filter(settled);
  expect(covered.length).toBeGreaterThan(0);
  for (const schedule of covered) {
    const label = schedule.map((step) => `${step.who}.${step.call}`).join(' ');
    const { github, claimers } = await race(schedule);
    expect(
      claimers.filter((result) => result.claimed),
      label,
    ).toHaveLength(1);
    for (const result of claimers)
      if (!result.claimed) expect(['held', 'lost-race'], label).toContain(result.reason);
    expect(
      github.waited.every((ms) => ms === SETTLE_MS),
      label,
    ).toBe(true);
  }
});

test('when a start outlasts the settle delay, the older winner loses at its heartbeat and only the newest posts a verdict', async () => {
  const uncovered = interleavings(3, 3).filter((schedule) => !settled(schedule));
  expect(uncovered.length).toBeGreaterThan(0);
  for (const schedule of uncovered) {
    const label = schedule.map((step) => `${step.who}.${step.call}`).join(' ');
    const { github, claimers } = await race(schedule);
    const held = claimers.flatMap((result) => (result.claimed ? [result.held] : []));
    const beats = await Promise.all(
      held.map((one) => heartbeat(github.copy(), SHA, one, START_S + 60, TTL_S)),
    );
    expect(
      beats.filter((beat) => beat !== 'lost'),
      label,
    ).toHaveLength(1);
    const verdicts = await Promise.all(
      held.map((one) => {
        const twin = github.copy();
        return postVerdict(twin, SHA, one, START_S + 60, twin.finisher(one.checkRun));
      }),
    );
    expect(
      verdicts.filter((verdict) => verdict === 'posted'),
      label,
    ).toHaveLength(1);
  }
});

async function heldByMac(): Promise<{ github: FakeGitHub; held: HeldLease }> {
  const github = new FakeGitHub();
  const claimed = await claim(github, SHA, MAC, START_S, TTL_S);
  if (!claimed.claimed) throw new Error('the first claim on an empty head holds');
  return { github, held: claimed.held };
}

test('a lease past its expiry plus the margin can be taken over; one within the margin cannot', async () => {
  const within = await heldByMac();
  expect(await claim(within.github, SHA, PC, EXPIRED_AT - 1, TTL_S)).toEqual({
    claimed: false,
    reason: 'held',
  });
  expect(within.github.runs, 'a refused claim starts nothing').toHaveLength(1);
  const past = await heldByMac();
  expect(await claim(past.github, SHA, PC, EXPIRED_AT, TTL_S)).toEqual({
    claimed: true,
    held: { checkRun: 102, lease: { ...PC, expiresAt: EXPIRED_AT + TTL_S } },
  });
});

test('a start without a lease, from another scheduler or by hand, blocks the claim as foreign-pending, never as expired', async () => {
  for (const title of [
    null,
    'Waiting',
    'lease:v1 m=Mac g=1 exp=1',
    'lease:v2 m=mac g=1 exp=1',
    'lease:v1 m=mac g=01 exp=1',
    ' lease:v1 m=mac g=1 exp=1',
  ]) {
    const github = new FakeGitHub();
    github.runs.push({ id: 7, completed: false, title });
    expect(await claim(github, SHA, PC, START_S + 10 * TTL_S, TTL_S), String(title)).toEqual({
      claimed: false,
      reason: 'foreign-pending',
    });
    expect(github.runs, `${title}: nothing started`).toHaveLength(1);
  }
});

test('a head whose newest Check is completed already has its verdict and is not claimed', async () => {
  const github = new FakeGitHub();
  github.runs.push({ id: 7, completed: false, title: formatLease({ ...MAC, expiresAt: 1 }, '') });
  github.runs.push({ id: 8, completed: true, title: 'Passed' });
  expect(await claim(github, SHA, PC, START_S, TTL_S)).toEqual({ claimed: false, reason: 'verdict' });
  expect(github.runs).toHaveLength(2);
});

test('a runner whose lease was taken over can neither heartbeat nor post a verdict', async () => {
  const { github, held } = await heldByMac();
  expect((await claim(github, SHA, PC, EXPIRED_AT, TTL_S)).claimed).toBe(true);
  expect(await heartbeat(github, SHA, held, EXPIRED_AT, TTL_S)).toBe('lost');
  let finished = false;
  const verdict = await postVerdict(github, SHA, held, START_S + 1, async () => {
    finished = true;
    return { id: held.checkRun };
  });
  expect(verdict).toBe('stale');
  expect(finished, 'finishCheckRun is never called for a stale lease').toBe(false);
});

test('a heartbeat renews the lease in place, so a claim at the old expiry is refused', async () => {
  const { github, held } = await heldByMac();
  const renewed = await heartbeat(github, SHA, held, START_S + 300, TTL_S);
  expect(renewed).toEqual({ checkRun: held.checkRun, lease: { ...MAC, expiresAt: START_S + 300 + TTL_S } });
  expect(github.runs, 'no new check run').toHaveLength(1);
  expect(await claim(github, SHA, PC, EXPIRED_AT, TTL_S)).toEqual({ claimed: false, reason: 'held' });
});

test('a runner restarted with a new generation cannot post for the old generation run', async () => {
  const { github, held: old } = await heldByMac();
  const restarted = { machine: 'mac', generation: 2 };
  expect(await claim(github, SHA, restarted, START_S + 1, TTL_S)).toEqual({ claimed: false, reason: 'held' });
  const claimed = await claim(github, SHA, restarted, EXPIRED_AT, TTL_S);
  if (!claimed.claimed) throw new Error('the restarted runner claims the expired head');
  expect(await postVerdict(github, SHA, old, START_S + 1, github.finisher(old.checkRun))).toBe('stale');
  expect(await heartbeat(github.copy(), SHA, old, START_S + 1, TTL_S)).toBe('lost');
  expect(
    await postVerdict(github, SHA, claimed.held, EXPIRED_AT, github.finisher(claimed.held.checkRun)),
  ).toBe('posted');
});

test('a verdict is refused within the margin of its own expiry by the poster clock, and a refusal by finishCheckRun is reported', async () => {
  const { github, held } = await heldByMac();
  const expiry = held.lease.expiresAt;
  const finish = github.finisher(held.checkRun);
  expect(await postVerdict(github, SHA, held, expiry - LEASE_MARGIN_S, finish)).toBe('stale');
  expect(
    await postVerdict(github, SHA, held, START_S, async () => ({ problem: 'GitHub answered 502' })),
  ).toEqual({
    problem: 'GitHub answered 502',
  });
  expect(await postVerdict(github, SHA, held, expiry - LEASE_MARGIN_S - 1, finish)).toBe('posted');
});

test('the lease title stays within 140 characters for the longest machine id and generation, and keeps its prefix', () => {
  const lease = {
    machine: 'z'.repeat(20),
    generation: Number.MAX_SAFE_INTEGER,
    expiresAt: Number.MAX_SAFE_INTEGER,
  };
  for (const note of ['ä'.repeat(200), '🔧'.repeat(200), `x${'🔧'.repeat(200)}`]) {
    const title = formatLease(lease, note);
    expect(title.length, note).toBeLessThanOrEqual(TITLE_LIMIT);
    expect(title.length, `${note}: the note is cut, not dropped`).toBeGreaterThanOrEqual(TITLE_LIMIT - 1);
    expect(title.isWellFormed(), note).toBe(true);
    expect(parseLease(title), note).toEqual(lease);
  }
  const short = { ...MAC, expiresAt: START_S };
  expect(formatLease(short, 'läuft')).toBe('lease:v1 m=mac g=1 exp=1800000000 läuft');
  expect(formatLease(short, '')).toBe('lease:v1 m=mac g=1 exp=1800000000');
  expect(() => formatLease({ ...short, machine: 'z'.repeat(21) }, '')).toThrow();
});

test('clock skew of 50 s either way between the machines never lets both run', async () => {
  for (const macSkew of [-50, 0, 50])
    for (const pcSkew of [-50, 0, 50]) {
      const { github, held } = await heldByMac();
      let takenOver = false;
      for (let real = START_S; real < START_S + TTL_S + 3 * LEASE_MARGIN_S && !takenOver; real += 5) {
        const macVerdict = await postVerdict(github.copy(), SHA, held, real + macSkew, async () => ({
          id: 1,
        }));
        takenOver = (await claim(github, SHA, PC, real + pcSkew, TTL_S)).claimed;
        const label = `mac ${macSkew}s, pc ${pcSkew}s, at +${real - START_S}s`;
        if (takenOver) {
          expect(macVerdict, label).toBe('stale');
          expect(await heartbeat(github.copy(), SHA, held, real + macSkew, TTL_S), label).toBe('lost');
        }
      }
      expect(takenOver, `mac ${macSkew}s, pc ${pcSkew}s: the PC takes over an abandoned lease`).toBe(true);
    }
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
