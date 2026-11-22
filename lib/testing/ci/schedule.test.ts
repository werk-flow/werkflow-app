// The orchestrator starts clock work at its Berlin time on both sides of a clock change, catches a
// missed slot up once, never holds a machine for the midnight window, and stops a superseded PR run.
import { expect, test } from 'bun:test';
import { execFileSync, type SpawnSyncReturns, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ciBrowserHoldUntil } from '../runner/group-schedule';
import { clockSlot, heldUntil, type ScheduleAnswer, scheduleDue, type ScheduleState } from './schedule';
import { workflowsFolder } from '../ci-workflow';

const repository = resolve(import.meta.dir, '../../..');
const at = (iso: string): Date => new Date(iso);
const MINUTE = 60_000;

function due(now: string, state: ScheduleState = {}, extra: Partial<Parameters<typeof scheduleDue>[0]> = {}) {
  return scheduleDue({
    now: at(now),
    state,
    fullRun: () => ({ run: false, reason: 'main has its full run.' }),
    releaseOnCron: false,
    fullRunning: false,
    held: [],
    prRuns: [],
    remoteHead: () => undefined,
    ...extra,
  });
}
const started = (answer: ScheduleAnswer): string[] =>
  answer.start.map((start) => ('slot' in start ? `${start.work} ${start.slot}` : start.work));

test('the release is due at 03:30 Berlin time in winter and in summer, on the weekdays around each clock change', () => {
  // Winter (UTC+1): 02:30 UTC. Summer (UTC+2): 01:30 UTC.
  expect(clockSlot('release', at('2026-11-23T02:30:00Z'), undefined).due?.toISOString()).toBe(
    '2026-11-23T02:30:00.000Z',
  );
  expect(clockSlot('release', at('2026-07-01T01:30:00Z'), undefined).due?.toISOString()).toBe(
    '2026-07-01T01:30:00.000Z',
  );
  // The Mondays after the changes of 2027-03-28 (to summer) and 2026-10-25 (to winter).
  expect(clockSlot('release', at('2027-03-29T01:29:00Z'), undefined)).toEqual({
    due: undefined,
    next: at('2027-03-29T01:30:00Z'),
  });
  expect(clockSlot('release', at('2026-10-26T02:29:00Z'), undefined)).toEqual({
    due: undefined,
    next: at('2026-10-26T02:30:00Z'),
  });
});

test('the nightly keeps 00:15 Berlin across a clock change, so its slots lie 23 or 25 hours apart', () => {
  const next = (now: string) => clockSlot('nightly', at(now), undefined).next.toISOString();
  const hoursBetween = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 3_600_000;
  // 00:15 on 2027-03-28 (UTC+1), then 00:15 on 2027-03-29 (UTC+2).
  expect(next('2027-03-27T23:16:00Z')).toBe('2027-03-28T22:15:00.000Z');
  expect(hoursBetween('2027-03-27T23:15:00Z', next('2027-03-27T23:16:00Z'))).toBe(23);
  // 00:15 on 2026-10-25 (UTC+2), then 00:15 on 2026-10-26 (UTC+1).
  expect(next('2026-10-24T22:16:00Z')).toBe('2026-10-25T23:15:00.000Z');
  expect(hoursBetween('2026-10-24T22:15:00Z', next('2026-10-24T22:16:00Z'))).toBe(25);
  // On the change nights themselves, 00:15 is before the change at 02:00 or 03:00.
  expect(next('2027-03-27T12:00:00Z')).toBe('2027-03-27T23:15:00.000Z');
  expect(next('2026-10-24T12:00:00Z')).toBe('2026-10-24T22:15:00.000Z');
});

test('no release is due on a Saturday or a Sunday, and the next one is Monday 03:30', () => {
  for (const now of ['2026-11-21T02:30:00Z', '2026-11-22T02:30:00Z', '2026-11-22T22:00:00Z'])
    expect(clockSlot('release', at(now), undefined)).toEqual({
      // Friday's slot is older than its late bound.
      due: undefined,
      next: at('2026-11-23T02:30:00Z'),
    });
  expect(started(due('2026-11-23T02:30:00Z', { nightly: '2026-11-22T23:15:00.000Z' }))).toEqual([
    'release 2026-11-23T02:30:00.000Z',
  ]);
});

test('a missed release still goes on until 16:30 Berlin of its own weekday, once, and never on the next day', () => {
  // The scheduler was down at 03:30 on Friday 2026-11-20.
  expect(clockSlot('release', at('2026-11-20T09:00:00Z'), undefined).due).toEqual(at('2026-11-20T02:30:00Z'));
  expect(clockSlot('release', at('2026-11-20T15:29:00Z'), undefined).due).toEqual(at('2026-11-20T02:30:00Z'));
  expect(clockSlot('release', at('2026-11-20T15:30:00Z'), undefined).due).toBeUndefined();
  // Started once, it is not due again that day, and a slot recorded the day before does not count.
  expect(clockSlot('release', at('2026-11-20T09:00:00Z'), at('2026-11-20T02:30:00Z')).due).toBeUndefined();
  expect(clockSlot('release', at('2026-11-20T09:00:00Z'), at('2026-11-19T02:30:00Z')).due).toEqual(
    at('2026-11-20T02:30:00Z'),
  );
});

test('missed nights coalesce into one nightly, due until it starts', () => {
  // Down from Wednesday to Friday noon: one nightly, Friday's.
  const answer = due('2026-11-20T11:00:00Z', {
    release: '2026-11-20T02:30:00.000Z',
    nightly: '2026-11-17T23:15:00.000Z',
  });
  expect(started(answer)).toEqual(['nightly 2026-11-19T23:15:00.000Z']);
  expect(
    started(
      due('2026-11-20T11:00:00Z', {
        release: '2026-11-20T02:30:00.000Z',
        nightly: '2026-11-19T23:15:00.000Z',
      }),
    ),
  ).toEqual([]);
});

test("the nightly never plans a midnight hold: every day's slot is outside ciBrowserHoldUntil", () => {
  for (
    let day = Date.parse('2026-01-01T12:00:00Z');
    day < Date.parse('2028-01-01T12:00:00Z');
    day += 86_400_000
  ) {
    const { next } = clockSlot('nightly', new Date(day), undefined);
    expect([next.toISOString(), ciBrowserHoldUntil(next)]).toEqual([next.toISOString(), undefined]);
  }
});

test("a nightly that starts now is main's full run, so no second full run starts beside it", () => {
  let asked = 0;
  const fullRun = () => {
    asked += 1;
    return { run: true, reason: 'A tooling change landed.' };
  };
  const nightly = due('2026-11-21T23:15:00Z', { release: '2026-11-20T02:30:00.000Z' }, { fullRun });
  expect([started(nightly), asked]).toEqual([['nightly 2026-11-21T23:15:00.000Z'], 1]);
  const day = due('2026-11-22T09:00:00Z', { nightly: '2026-11-21T23:15:00.000Z' }, { fullRun });
  expect([started(day), asked]).toEqual([['full'], 2]);
});

test('the nightly skips a head that already has a full run, and stays due until main moves on or its next slot', () => {
  const tested = () => ({ run: false, reason: 'c3 already has a full run.', headHasFullRun: true as const });
  const state = { release: '2026-11-20T02:30:00.000Z' };
  expect(started(due('2026-11-21T23:15:00Z', state, { fullRun: tested }))).toEqual([]);
  // Main moved on: the missed nightly starts, as that head's full run.
  const moved = () => ({ run: true, reason: 'main moved 1 commits since the full run on c3.' });
  expect(started(due('2026-11-22T09:00:00Z', state, { fullRun: moved }))).toEqual([
    'nightly 2026-11-21T23:15:00.000Z',
  ]);
  // A rule without an answer cannot show the head tested: the nightly starts.
  const unreadable = () => ({ unreadable: 'the ledger cannot count' });
  expect(started(due('2026-11-21T23:15:00Z', state, { fullRun: unreadable }))).toEqual([
    'nightly 2026-11-21T23:15:00.000Z',
  ]);
});

test('a full-run rule without an answer is unanswered, never a start', () => {
  const answer = due(
    '2026-11-22T09:00:00Z',
    { nightly: '2026-11-21T23:15:00.000Z' },
    {
      fullRun: () => ({ unreadable: 'the ledger cannot count' }),
    },
  );
  expect([answer.start, answer.unanswered]).toEqual([
    [],
    [{ work: 'full', reason: 'the ledger cannot count' }],
  ]);
});

test('held browser shards start when the midnight window closes, and the scheduler wakes for it', () => {
  // A plan made at 23:00 Berlin holds its shards until 00:10 (ciBrowserHoldUntil).
  const planned = at('2026-11-20T22:00:00Z');
  const until = ciBrowserHoldUntil(planned);
  expect(until?.toISOString()).toBe('2026-11-20T23:10:00.000Z');
  const plan = {
    jobs: ['plan', 'fast', 'midnight', 'browser', 'check'],
    outputs: { midnight_until: until?.toISOString() ?? '' },
  };
  const held = [{ run: 'run-1', until: heldUntil(plan) }];
  const state = { release: '2026-11-20T02:30:00.000Z', nightly: '2026-11-19T23:15:00.000Z' };
  const before = due(new Date(Date.parse('2026-11-20T23:10:00Z') - MINUTE).toISOString(), state, { held });
  expect([before.start, before.wakeAt]).toEqual([[], '2026-11-20T23:10:00.000Z']);
  expect(due('2026-11-20T23:10:00Z', state, { held }).start).toEqual([
    {
      work: 'midnight',
      run: 'run-1',
      reason: 'The midnight start window closed at 2026-11-20T23:10:00.000Z; its browser shards follow.',
    },
  ]);
});

test('a run without a midnight job is never held, and one whose hold cannot be read is unanswered', () => {
  expect(
    heldUntil({ jobs: ['plan', 'fast', 'browser', 'check'], outputs: { midnight_until: '' } }),
  ).toBeUndefined();
  const unreadable = heldUntil({ jobs: ['midnight'], outputs: { midnight_until: '' } });
  expect(unreadable).toEqual({
    unreadable: 'the plan runs the midnight job but sets no readable midnight_until',
  });
  const answer = due(
    '2026-11-22T09:00:00Z',
    { nightly: '2026-11-21T23:15:00.000Z' },
    {
      held: [{ run: 'run-2', until: unreadable }],
    },
  );
  expect(answer.unanswered).toEqual([
    { work: 'midnight', reason: 'run-2: the plan runs the midnight job but sets no readable midnight_until' },
  ]);
});

test('a pull request run stops only when its head moved on; the current head or no answer keeps it running', () => {
  const tested = 'a'.repeat(40);
  const ask = (heads: Record<string, string>) =>
    due(
      '2026-11-22T09:00:00Z',
      { nightly: '2026-11-21T23:15:00.000Z' },
      {
        prRuns: [{ run: 'pr568', headRef: 'refs/pull/568/head', testedHead: tested }],
        remoteHead: (ref) => heads[ref],
      },
    ).stop;
  expect(ask({ 'refs/pull/568/head': 'b'.repeat(40) })).toEqual([
    { run: 'pr568', reason: `refs/pull/568/head moved on from ${tested} to ${'b'.repeat(40)}.` },
  ]);
  expect(ask({ 'refs/pull/568/head': tested })).toEqual([]);
  expect(ask({})).toEqual([]);
});

test('the scheduler wakes at the next clock slot when nothing is held', () => {
  // Saturday morning: the nightly at 00:15 Sunday comes before Monday's release.
  expect(due('2026-11-21T09:00:00Z', { nightly: '2026-11-20T23:15:00.000Z' }).wakeAt).toBe(
    '2026-11-21T23:15:00.000Z',
  );
});

/**
 * A clean repository with this checkout's schedule.ts and lib, its own origin, and a fake
 * full-run.ts that prints FULL_RUN_ANSWER and exits with FULL_RUN_EXIT.
 */
function schedulerFixture(folder: string): {
  root: string;
  run: (...args: string[]) => SpawnSyncReturns<string>;
} {
  const root = join(folder, 'repository');
  mkdirSync(join(root, 'scripts/ci'), { recursive: true });
  copyFileSync(join(repository, 'scripts/ci/schedule.ts'), join(root, 'scripts/ci/schedule.ts'));
  for (const link of ['lib', 'node_modules', 'tsconfig.json'])
    symlinkSync(join(repository, link), join(root, link));
  writeFileSync(
    join(root, 'scripts/ci/full-run.ts'),
    "console.info(process.env.FULL_RUN_ANSWER);\nprocess.exit(Number(process.env.FULL_RUN_EXIT ?? '0'));\n",
  );
  // A release GitHub's cron does not start: the runner dispatches it.
  mkdirSync(join(root, '.github/workflows'), { recursive: true });
  writeFileSync(join(root, '.github/workflows/release.yml'), 'on:\n  workflow_dispatch:\n');
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=ci', '-c', 'user.email=ci@example.invalid', ...args], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
  git('init', '--quiet');
  git('add', '--all');
  git('commit', '--quiet', '--message', 'fixture');
  git('remote', 'add', 'origin', root);
  git('update-ref', 'refs/pull/7/head', 'HEAD');
  return {
    root,
    run: (...args) =>
      spawnSync(process.execPath, ['scripts/ci/schedule.ts', ...args], {
        cwd: root,
        encoding: 'utf8',
        env: {
          NODE_ENV: 'test',
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          FULL_RUN_ANSWER: '{"run":true,"reason":"A tooling change landed."}',
        },
      }),
  };
}

test('the CLI answers from its state, the full-run rule, held runs and moved pull request heads', () => {
  const folder = mkdtempSync(join(tmpdir(), 'ci-schedule-'));
  try {
    const { root, run } = schedulerFixture(folder);
    const state = join(folder, 'state.json');
    // Both clock works started a slot later than any due one, in one call, so only the rest decides.
    expect(
      run('started', 'release', '2100-01-01T00:00:00Z', 'nightly', '2100-01-01T00:00:00Z', '--state', state)
        .status,
    ).toBe(0);
    // A late confirmation of an older slot keeps the newer one.
    expect(run('started', 'release', '2099-01-01T00:00:00Z', '--state', state).status).toBe(0);
    expect(JSON.parse(readFileSync(state, 'utf8'))).toEqual({
      release: '2100-01-01T00:00:00.000Z',
      nightly: '2100-01-01T00:00:00.000Z',
    });
    const held = join(folder, 'held');
    mkdirSync(held);
    writeFileSync(
      join(held, 'plan.json'),
      JSON.stringify({
        version: 1,
        job: 'plan',
        shard: null,
        event: 'integration',
        tree: 'a'.repeat(40),
        commit: 'a'.repeat(40),
        base: null,
        status: 'passed',
        groups: [],
        planReason: 'Selection by diff',
        reusedFrom: null,
        listGrowthApproved: false,
        producer: 'mac-standin',
        runUrl: 'https://ci.example/runs/1',
        startedAt: '2026-11-20T22:00:00.000Z',
        completedAt: '2026-11-20T22:01:00.000Z',
        plan: {
          jobs: ['plan', 'fast', 'midnight', 'browser', 'check'],
          skips: {},
          shards: [{ shard: 1, groups: 'golden:p1-24a' }],
          outputs: { midnight_until: '2000-01-01T23:10:00.000Z' },
        },
      }),
    );
    const tested = 'c'.repeat(40);
    const answer = run('due', '--state', state, '--run', held, '--pr-run', `pr7,refs/pull/7/head,${tested}`);
    expect(answer.status, answer.stderr).toBe(0);
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    expect(JSON.parse(answer.stdout)).toMatchObject({
      start: [
        { work: 'full', reason: 'A tooling change landed.' },
        { work: 'midnight', run: held },
      ],
      stop: [{ run: 'pr7', reason: `refs/pull/7/head moved on from ${tested} to ${head}.` }],
      unanswered: [],
    });
    // A started midnight job is no longer due.
    writeFileSync(join(held, 'midnight.json'), '{}');
    expect(JSON.parse(run('due', '--state', state, '--run', held).stdout).start).toEqual([
      { work: 'full', reason: 'A tooling change landed.' },
    ]);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('the CLI exits 1 on an unreadable state, and after its answer when the full-run rule gave none', () => {
  const folder = mkdtempSync(join(tmpdir(), 'ci-schedule-'));
  try {
    const { root } = schedulerFixture(folder);
    const state = join(folder, 'state.json');
    writeFileSync(state, '{"release":"yesterday"}');
    const run = (env: Record<string, string>) =>
      spawnSync(process.execPath, ['scripts/ci/schedule.ts', 'due', '--state', state], {
        cwd: root,
        encoding: 'utf8',
        env: { NODE_ENV: 'test', PATH: process.env.PATH, HOME: process.env.HOME, ...env },
      });
    const corrupt = run({});
    expect([corrupt.status, corrupt.stdout]).toEqual([1, '']);
    writeFileSync(state, '{"release":"2100-01-01T00:00:00.000Z","nightly":"2100-01-01T00:00:00.000Z"}');
    const silent = run({ FULL_RUN_ANSWER: '', FULL_RUN_EXIT: '1' });
    expect(silent.status).toBe(1);
    expect(JSON.parse(silent.stdout)).toMatchObject({
      start: [],
      unanswered: [{ work: 'full', reason: 'scripts/ci/full-run.ts due ended 1 without an answer' }],
    });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('a missed nightly stays due until the next slot, through the 25-hour day of the autumn clock change', () => {
  // 00:15 on 2026-10-25 (UTC+2); 22:00 that day (UTC+1) is 24 h 45 min later.
  expect(clockSlot('nightly', at('2026-10-25T21:00:00Z'), undefined).due).toEqual(at('2026-10-24T22:15:00Z'));
  expect(started(due('2026-10-25T21:00:00Z', { release: '2026-10-23T01:30:00.000Z' }))).toEqual([
    'nightly 2026-10-24T22:15:00.000Z',
  ]);
});

test('a missed nightly never starts where it would plan a midnight hold, and waits for the next slot instead', () => {
  const missed = { release: '2026-01-01T02:30:00.000Z', nightly: '2026-01-01T23:15:00.000Z' };
  // The week of each clock change, every five minutes from 19:00 to 24:00 UTC: 20:00 or 21:00 to
  // 01:00 or 02:00 Berlin, around every hold.
  for (const from of ['2026-10-22T19:00:00Z', '2027-03-25T19:00:00Z'])
    for (let time = Date.parse(from); time < Date.parse(from) + 7 * 86_400_000; time += 5 * MINUTE) {
      const now = new Date(time);
      if (now.getUTCHours() < 19) continue;
      const starts = started(due(now.toISOString(), missed)).some((start) => start.startsWith('nightly'));
      expect([now.toISOString(), starts ? ciBrowserHoldUntil(now) : undefined]).toEqual([
        now.toISOString(),
        undefined,
      ]);
    }
  // 23:00 Berlin waits; 00:15 starts the next slot instead; 22:00 still catches up.
  expect(started(due('2026-11-21T22:00:00Z', missed))).toEqual([]);
  expect(started(due('2026-11-21T23:15:00Z', missed))).toEqual(['nightly 2026-11-21T23:15:00.000Z']);
  expect(started(due('2026-11-21T21:00:00Z', missed))).toEqual(['nightly 2026-11-20T23:15:00.000Z']);
});

test('a due nightly waits while a full run runs, and starts when the ledger cannot say', () => {
  const state = { release: '2026-11-20T02:30:00.000Z' };
  expect(started(due('2026-11-21T23:15:00Z', state, { fullRunning: true }))).toEqual([]);
  const unknown = due('2026-11-21T23:15:00Z', state, {
    fullRunning: { unreadable: 'ledger.jsonl:3 is no JSON' },
  });
  expect([started(unknown), unknown.unanswered]).toEqual([
    ['nightly 2026-11-21T23:15:00.000Z'],
    [{ work: 'nightly', reason: 'Whether a full run runs is unknown: ledger.jsonl:3 is no JSON' }],
  ]);
});

test("while GitHub's cron starts the release, the scheduler never names it, so a weekday gets one release", () => {
  const monday = '2026-11-23T02:30:00Z';
  const state = { nightly: '2026-11-22T23:15:00.000Z' };
  expect(started(due(monday, state))).toEqual(['release 2026-11-23T02:30:00.000Z']);
  const onCron = due(monday, state, { releaseOnCron: true });
  expect([onCron.start, onCron.unanswered]).toEqual([[], []]);
  // The nightly's next slot, not Tuesday's release, wakes the runner.
  expect(onCron.wakeAt).toBe('2026-11-23T23:15:00.000Z');
  const unknown = due(monday, state, { releaseOnCron: { unreadable: 'release.yml names no triggers' } });
  expect([unknown.start, unknown.unanswered]).toEqual([
    [],
    [{ work: 'release', reason: 'release.yml names no triggers' }],
  ]);
});

test("the CLI reads release.yml's cron: with one it never names the release", () => {
  const folder = mkdtempSync(join(tmpdir(), 'ci-schedule-'));
  try {
    const { root, run } = schedulerFixture(folder);
    copyFileSync(
      join(repository, workflowsFolder(), 'release.yml'),
      join(root, '.github/workflows/release.yml'),
    );
    // No state: every clock work has a missed slot, and only the nightly may be named.
    const answer = run('due', '--state', join(folder, 'state.json'));
    expect(answer.status, answer.stderr).toBe(0);
    expect(JSON.parse(answer.stdout)).toMatchObject({ unanswered: [] });
    expect(answer.stdout).not.toContain('"work":"release"');
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
