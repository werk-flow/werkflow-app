// The production watcher's rules: each fires on stubbed metadata, stays quiet otherwise, reads no
// more than metadata, and survives a lost state or a failed write (lib/production-watch/watch.ts).
import { expect, test } from 'bun:test';

import {
  DEPLOY,
  ERRORS,
  HANDLED,
  readState,
  SERVER_ERRORS,
  type Title,
  WATCHER,
  WatchError,
  type WatchIo,
  type WatchState,
  watch,
} from './watch';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-11-07T12:02:00Z');
const HEAD = 'a'.repeat(40);

type Row = { at: number; values: Record<string, string>; count: number };
type Sent = { title: Title; action: 'keep' | 'close'; note: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const field = (value: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>((at, key) => (isRecord(at) ? at[key] : undefined), value);

/** Vercel and GitHub as the watcher sees them, from a few facts a test sets. */
class FakeProduction implements WatchIo {
  deployments: Record<string, unknown>[] = [
    {
      uid: 'dpl_live',
      state: 'READY',
      created: NOW - DAY,
      meta: { githubCommitSha: HEAD, githubCommitMessage: 'public text' },
      inspectorUrl: 'https://vercel.com/team/app/live',
    },
  ];
  alias = 'dpl_live';
  head = HEAD;
  details: Record<string, Record<string, string>> = {};
  errors: Row[] = [];
  failures: Row[] = [];
  open = new Set<string>();
  paths: string[] = [];
  bodies: unknown[] = [];
  sent: Sent[] = [];
  refuse: string | undefined;
  refuseWrite: Title | undefined;
  // Vercel may leave out a bucket without a count; a sparse answer does.
  sparse = false;

  vercel = async (path: string, body?: unknown): Promise<unknown> => {
    this.paths.push(path);
    if (this.refuse && path.includes(this.refuse))
      throw new WatchError(`Vercel answered 403 to ${path.split('?')[0]}`);
    if (path.startsWith('/v6/deployments'))
      return { deployments: this.deployments, pagination: { next: null } };
    if (path.startsWith('/v4/aliases/')) return { deploymentId: this.alias };
    if (path.startsWith('/v13/deployments/')) {
      const uid = path.split('/')[3]?.split('?')[0] ?? '';
      return { readyState: 'ERROR', errorMessage: 'free text of the build', ...this.details[uid] };
    }
    if (path.startsWith('/metrics/v1')) {
      this.bodies.push(body);
      return this.metrics(body);
    }
    throw new Error(`unexpected call ${path}`);
  };

  productionHead = async () => this.head;
  openTitles = async () => new Set([...this.open, 'Bug']);
  act = async (title: Title, action: 'keep' | 'close', note: string) => {
    if (this.refuseWrite === title) throw new WatchError('.github/scripts/alert-issue.sh failed (exit 1)');
    this.sent.push({ title, action, note });
  };

  private metrics(body: unknown) {
    const start = Date.parse(String(field(body, 'timeRange', 'start')));
    const end = Date.parse(String(field(body, 'timeRange', 'end')));
    const size = Number(field(body, 'bucketSeconds')) * 1000;
    const groupBy = field(body, 'groupBy');
    const names = Array.isArray(groupBy) ? groupBy.map(String) : [];
    let rows = this.errors;
    if (field(body, 'metrics', 'value', 'metric') === 'werkflow.failure') {
      // The metric has no environment: only a filter on deployment ids narrows it to production.
      const named = new Set(
        String(field(body, 'filter'))
          .split(' OR ')
          .map((clause) => clause.replace(/^deploymentId:/, '')),
      );
      rows = this.failures.filter((row) => named.has(row.values.deploymentId ?? ''));
    }
    const groups = new Map<string, Map<number, number>>();
    for (const row of rows) {
      if (row.at < start || row.at >= end) continue;
      const dimensions = Object.fromEntries(
        Object.entries(row.values).filter(([name]) => names.includes(name)),
      );
      const key = JSON.stringify(dimensions);
      const bucket = start + size * Math.floor((row.at - start) / size);
      const buckets = groups.get(key) ?? new Map<number, number>();
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + row.count);
      groups.set(key, buckets);
    }
    const series: unknown[] = [];
    const summary: unknown[] = [];
    for (const [key, buckets] of groups) {
      const dimensions: unknown = JSON.parse(key);
      for (let moment = start; moment < end; moment += size)
        if (!this.sparse || buckets.has(moment))
          series.push({
            timestamp: new Date(moment).toISOString(),
            dimensions,
            values: { value: buckets.get(moment) ?? 0 },
          });
      summary.push({
        dimensions,
        values: { value: [...buckets.values()].reduce((sum, count) => sum + count, 0) },
      });
    }
    return { queryId: 'q', meta: {}, series, summary };
  }
}

function setup() {
  const fake = new FakeProduction();
  const state: WatchState = readState(undefined);
  const check = async (now = NOW) => (await watch(fake, state, now)).notes;
  const sent = (title?: Title, action?: 'keep' | 'close') =>
    fake.sent.filter(
      (s) => (title === undefined || s.title === title) && (action === undefined || s.action === action),
    );
  const deploy = (uid: string, deployState: string, age: number, sha = HEAD) =>
    fake.deployments.unshift({
      uid,
      state: deployState,
      created: NOW - age,
      meta: { githubCommitSha: sha },
      inspectorUrl: `https://vercel.com/team/app/${uid}`,
    });
  const error = (minutesAgo: number, count: number, route = '/auftraege/[jobId]') =>
    fake.errors.push({
      at: NOW - minutesAgo * MINUTE,
      values: { route, httpStatus: '500', errorCode: 'FUNCTION_INVOCATION_FAILED', deploymentId: 'dpl_live' },
      count,
    });
  const oldError = (at: number, route = '/auftraege/[jobId]', count = 1) =>
    fake.errors.push({
      at,
      values: { route, httpStatus: '500', errorCode: '', deploymentId: 'dpl_old' },
      count,
    });
  const failure = (
    at: number,
    count: number,
    label = 'createClient_insert_failed',
    code = '23505',
    deployment = 'dpl_live',
  ) => fake.failures.push({ at, values: { label, code, deploymentId: deployment }, count });
  return { fake, state, check, sent, deploy, error, oldError, failure };
}

const one = <T>(list: readonly T[]): T => {
  expect(list).toHaveLength(1);
  const [only] = list;
  if (only === undefined) throw new Error('no element');
  return only;
};

test('a healthy production raises nothing', async () => {
  const { fake, check } = setup();
  expect(await check()).toEqual([]);
  expect(fake.sent).toEqual([]);
});

test('D1: a failed build is reported once after its deadline, with its code and never its message', async () => {
  const { fake, check, sent, deploy } = setup();
  deploy('dpl_bad', 'ERROR', 50 * MINUTE, 'c'.repeat(40));
  fake.details.dpl_bad = { errorCode: 'BUILD_FAILED', errorStep: 'build' };
  await check();
  await check(NOW + 10 * MINUTE);
  const { note } = one(sent(DEPLOY, 'keep'));
  expect(note).toContain('dpl_bad');
  expect(note).toContain('BUILD_FAILED');
  expect(note).toContain('| failed | ERROR |');
  expect(note).not.toContain('free text');
  expect(note).not.toContain('public text');
  expect(fake.paths.filter((path) => path.includes('/events') || path.includes('logs'))).toEqual([]);
  // Only the failed deployment is read in detail.
  expect(fake.paths.filter((path) => path.startsWith('/v13/')).map((path) => path.split('?')[0])).toEqual([
    '/v13/deployments/dpl_bad',
  ]);
});

test('D1: a failed build inside its deadline waits, and one another build replaced raises nothing', async () => {
  const { fake, check, deploy } = setup();
  deploy('dpl_fresh', 'ERROR', 40 * MINUTE, 'c'.repeat(40));
  await check();
  expect(fake.sent).toEqual([]);

  const replaced = setup();
  replaced.deploy('dpl_bad', 'CANCELED', 2 * HOUR, 'c'.repeat(40));
  replaced.deploy('dpl_again', 'READY', HOUR, 'c'.repeat(40));
  await replaced.check();
  expect(replaced.fake.sent).toEqual([]);
  replaced.fake.deployments = replaced.fake.deployments.filter((d) => d.uid !== 'dpl_again');
  replaced.deploy('dpl_newer', 'READY', HOUR, 'd'.repeat(40));
  replaced.fake.alias = 'dpl_newer';
  replaced.fake.head = 'd'.repeat(40);
  await replaced.check();
  expect(replaced.fake.sent).toEqual([]);
});

test('D2: a build stuck past its deadline is reported', async () => {
  const { fake, check, sent, deploy } = setup();
  deploy('dpl_slow', 'BUILDING', 40 * MINUTE);
  await check();
  expect(fake.sent).toEqual([]);
  await check(NOW + 10 * MINUTE);
  expect(one(sent(DEPLOY, 'keep')).note).toContain('| stuck | BUILDING |');
});

test('D3: production not serving its head is reported after an hour, once', async () => {
  const { fake, check, sent } = setup();
  fake.head = 'e'.repeat(40);
  await check();
  await check(NOW + 50 * MINUTE);
  expect(fake.sent).toEqual([]);
  await check(NOW + 60 * MINUTE);
  await check(NOW + 70 * MINUTE);
  const { note } = one(sent(DEPLOY, 'keep'));
  expect(note).toContain('a rollback or a failed promotion');
  expect(note).toContain('dpl_live');
});

test('D3: a promotion inside the hour raises nothing, and a later mismatch starts its hour anew', async () => {
  const { fake, check, deploy } = setup();
  fake.head = 'e'.repeat(40);
  await check();
  deploy('dpl_next', 'READY', 0, 'e'.repeat(40));
  fake.alias = 'dpl_next';
  await check(NOW + 30 * MINUTE);
  fake.alias = 'dpl_live';
  await check(NOW + 70 * MINUTE);
  expect(fake.sent).toEqual([]);
});

test('the deploy alert closes when production serves its head, and stays open while a build is failed', async () => {
  const { fake, check, sent, deploy } = setup();
  fake.head = 'e'.repeat(40);
  await check();
  await check(NOW + 60 * MINUTE);
  fake.open.add(DEPLOY);
  deploy('dpl_fixed', 'READY', 0, 'e'.repeat(40));
  fake.alias = 'dpl_fixed';
  await check(NOW + 70 * MINUTE);
  expect(sent(DEPLOY, 'close')).toHaveLength(1);

  const failed = setup();
  failed.deploy('dpl_bad', 'ERROR', 50 * MINUTE, 'c'.repeat(40));
  await failed.check();
  failed.fake.open.add(DEPLOY);
  await failed.check(NOW + 10 * MINUTE);
  expect(failed.sent(DEPLOY, 'close')).toEqual([]);
});

test('S1: a burst opens the server-error alert with its table', async () => {
  const { check, sent, error } = setup();
  error(12, 3);
  error(9, 3);
  await check();
  const { note } = one(sent(ERRORS, 'keep'));
  expect(note).toContain('| burst |');
  expect(note).toContain('`/auftraege/[jobId]` | 500 | FUNCTION_INVOCATION_FAILED | dpl_live | 6 |');
});

test('S1: four errors in a window are no burst', async () => {
  const { fake, check, error, oldError } = setup();
  error(12, 2);
  error(9, 2);
  for (const days of [2, 3, 4]) oldError(NOW - days * DAY); // an old route, so S2 stays quiet too
  await check();
  expect(fake.sent).toEqual([]);
});

test('S1: a count within four times the weekly mean is no burst', async () => {
  const { fake, check, sent, error, oldError } = setup();
  // 7 days with 3 errors in every 15 minutes: a mean of 3, so a burst needs 12.
  for (let moment = NOW - 8 * DAY; moment < NOW - DAY; moment += 15 * MINUTE)
    oldError(moment, '/auftraege/[jobId]', 3);
  error(12, 11);
  await check();
  expect(fake.sent).toEqual([]);
  error(9, 1);
  await check();
  expect(sent(ERRORS, 'keep')).toHaveLength(1);
});

test('S1: a window is 15 minutes by the clock, even when the answer leaves out empty buckets', async () => {
  const burst = setup();
  burst.fake.sparse = true;
  burst.error(12, 6);
  await burst.check();
  expect(one(burst.sent(ERRORS, 'keep')).note).toContain('| burst |');

  const spread = setup();
  spread.fake.sparse = true;
  for (const minutes of [12, 62, 122]) spread.error(minutes, 2);
  spread.oldError(NOW - 3 * DAY); // an old route, so S2 stays quiet
  await spread.check();
  expect(spread.fake.sent).toEqual([]);
});

test('S1: errors in the newest incomplete bucket wait for the next pass', async () => {
  const { fake, check, sent, error } = setup();
  error(1, 9);
  await check();
  expect(fake.sent).toEqual([]);
  await check(NOW + 10 * MINUTE);
  expect(sent(ERRORS, 'keep')).toHaveLength(1);
});

test('S2: a new failing route opens the alert, and one that failed in the week before is not new', async () => {
  const { check, sent, error } = setup();
  for (const hours of [20, 9, 1]) error(hours * 60, 1, '/kunden/[clientId]');
  await check();
  const { note } = one(sent(ERRORS, 'keep'));
  expect(note).toContain('| new route |');
  expect(note).toContain('`/kunden/[clientId]`');

  const known = setup();
  for (const hours of [20, 9, 1]) known.error(hours * 60, 1, '/kunden/[clientId]');
  known.oldError(NOW - 3 * DAY, '/kunden/[clientId]');
  await known.check();
  expect(known.fake.sent).toEqual([]);
});

test('an open server-error alert gets at most one comment in six hours', async () => {
  const { fake, check, sent, error } = setup();
  error(12, 6);
  await check();
  fake.open.add(ERRORS);
  error(-20, 6); // a new burst 30 minutes later
  await check(NOW + 40 * MINUTE);
  expect(sent(ERRORS, 'keep')).toHaveLength(1);
  await check(NOW + 6 * HOUR);
  expect(sent(ERRORS, 'keep')).toHaveLength(2);
  await check(NOW + 6 * HOUR + 10 * MINUTE);
  expect(sent(ERRORS, 'keep')).toHaveLength(2);
});

test('the server-error alert closes a day after its newest error', async () => {
  const { fake, check, sent, error } = setup();
  error(12, 6);
  await check();
  fake.open.add(ERRORS);
  await check(NOW + 23 * HOUR);
  // Later windows over the same burst are no new finding.
  expect(sent(ERRORS, 'keep')).toHaveLength(1);
  expect(sent(ERRORS, 'close')).toEqual([]);
  await check(NOW + 24 * HOUR + 10 * MINUTE);
  expect(sent(ERRORS, 'close')).toHaveLength(1);
});

test('the metrics query asks only for codes and counts, with times to the second', async () => {
  const { fake, check, error } = setup();
  error(12, 6);
  await check();
  const metric = (body: unknown) => field(body, 'metrics', 'value', 'metric');
  const requests = fake.bodies.filter((body) => metric(body) === 'vercel.request.count');
  const failures = fake.bodies.filter((body) => metric(body) === 'werkflow.failure');
  expect([requests.length, failures.length]).toEqual([2, 2]);
  const allowed = new Set(['route', 'httpStatus', 'errorCode', 'deploymentId', 'serverActionName']);
  for (const body of requests) {
    const groupBy = field(body, 'groupBy');
    expect(Array.isArray(groupBy) && groupBy.every((name) => allowed.has(String(name)))).toBe(true);
    expect(field(body, 'filter')).toBe('environment:production AND httpStatus >= 500');
    expect(field(body, 'metrics')).toEqual({
      value: { metric: 'vercel.request.count', aggregation: 'count' },
    });
  }
  for (const body of failures) {
    const groupBy = field(body, 'groupBy');
    expect(
      Array.isArray(groupBy) &&
        groupBy.every((name) => ['label', 'code', 'deploymentId'].includes(String(name))),
    ).toBe(true);
    expect(field(body, 'metrics')).toEqual({ value: { metric: 'werkflow.failure', aggregation: 'sum' } });
  }
  // The API refuses a time without seconds.
  for (const body of fake.bodies)
    for (const moment of [field(body, 'timeRange', 'start'), field(body, 'timeRange', 'end')])
      expect(String(moment)).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  expect(SERVER_ERRORS.tags).toEqual([]);
});

test('H1 and H2: a handled failure opens, updates and closes one issue', async () => {
  const { fake, check, sent, failure } = setup();
  failure(NOW - 12 * MINUTE, 3);
  await check();
  const opened = one(sent(HANDLED, 'keep'));
  expect(opened.note).toContain('| Rule | Window (UTC) | Label | Code | Deployment | Count |');
  expect(opened.note).toContain('| new failure |');
  expect(opened.note).toContain('| `createClient_insert_failed` | 23505 | dpl_live | 3 |');
  fake.open.add(HANDLED);
  const later = NOW + 6 * HOUR;
  failure(later - 12 * MINUTE, 6, 'jobs.save_failed', 'none');
  await check(later);
  await check(later + 10 * MINUTE);
  const [, updated] = sent(HANDLED, 'keep');
  expect(updated?.note).toContain('| burst |');
  expect(updated?.note).toContain('| `jobs.save_failed` | none | dpl_live | 6 |');
  await check(later + 23 * HOUR);
  expect(sent(HANDLED, 'close')).toEqual([]);
  await check(later + 24 * HOUR + 10 * MINUTE);
  expect(sent(HANDLED).map((s) => s.action)).toEqual(['keep', 'keep', 'close']);
  expect(one(sent(HANDLED, 'close')).note).toContain('No handled-failure finding for 24 hours.');
  expect(sent(ERRORS)).toEqual([]);
});

test("handled failures on staging raise nothing: the count names production's deployments", async () => {
  const { fake, check, failure } = setup();
  // Staging deploys to the same project, and the metric has no environment to filter on.
  failure(NOW - 12 * MINUTE, 9, 'createClient_insert_failed', '23505', 'dpl_staging');
  await check();
  expect(fake.sent).toEqual([]);
  const filters = (f: FakeProduction) =>
    new Set(
      f.bodies
        .filter((body) => field(body, 'metrics', 'value', 'metric') === 'werkflow.failure')
        .map((body) => field(body, 'filter')),
    );
  expect(filters(fake)).toEqual(new Set(['deploymentId:dpl_live']));

  const rolledBack = setup();
  rolledBack.deploy('dpl_new', 'READY', 2 * HOUR);
  rolledBack.fake.alias = 'dpl_rolled_back_to'; // served, though created before the listing's lookback
  await rolledBack.check();
  expect(filters(rolledBack.fake)).toEqual(
    new Set(['deploymentId:dpl_live OR deploymentId:dpl_new OR deploymentId:dpl_rolled_back_to']),
  );
});

test('H2: a label and code that failed in the week before is no new failure', async () => {
  const { fake, check, failure } = setup();
  failure(NOW - 12 * MINUTE, 3);
  failure(NOW - 3 * DAY, 1);
  await check();
  expect(fake.sent).toEqual([]);
});

test('three failed passes open the watcher alert once, and a good pass closes it', async () => {
  const { fake, state, check, sent } = setup();
  fake.refuse = '/metrics/v1';
  let notes: string[] = [];
  for (const minutes of [0, 10, 20, 30]) notes = await check(NOW + minutes * MINUTE);
  expect(notes[0]).toBe(
    'production: production watcher failed (4 in a row): Vercel answered 403 to /metrics/v1',
  );
  const { note } = one(sent(WATCHER, 'keep'));
  expect(note).toContain('failed 3 passes in a row');
  expect(note).toContain('prod-watch.yml');
  fake.refuse = undefined;
  fake.open.add(WATCHER);
  await check(NOW + 40 * MINUTE);
  expect(sent(WATCHER, 'close')).toHaveLength(1);
  expect(state.failures).toBe(0);
  expect(state.watcherReported).toBe(false);
});

test('an alert whose write failed is written by the next pass, and the failure counts', async () => {
  const { fake, state, check, sent, deploy } = setup();
  deploy('dpl_bad', 'ERROR', 50 * MINUTE, 'c'.repeat(40));
  fake.refuseWrite = DEPLOY;
  const failed = await watch(fake, state, NOW);
  expect(failed).toEqual({
    notes: [
      'production: production watcher failed (1 in a row): .github/scripts/alert-issue.sh failed (exit 1)',
    ],
    failed: true,
  });
  expect(state.reported).toEqual([]);
  fake.refuseWrite = undefined;
  await check(NOW + 10 * MINUTE);
  expect(one(sent(DEPLOY, 'keep')).note).toContain('dpl_bad');
  expect(state.failures).toBe(0);
});

test('a lost or unreadable state starts fresh, and a saved one carries over', async () => {
  expect(readState('not json')).toEqual({
    failures: 0,
    watcherReported: false,
    reported: [],
    errors: {},
    handled: {},
  });
  expect(readState({ failures: 'two', reported: [1, 'dpl_a'], errors: { until: 3 } })).toEqual({
    failures: 0,
    watcherReported: false,
    reported: ['dpl_a'],
    errors: {},
    handled: {},
  });
  const { fake, state, check, sent, error } = setup();
  error(12, 6);
  await check();
  fake.open.add(ERRORS);
  // The next run reads the state from the cache as JSON.
  const carried = readState(JSON.parse(JSON.stringify(state)));
  await watch(fake, carried, NOW + 40 * MINUTE);
  expect(sent(ERRORS, 'keep')).toHaveLength(1);
  // A fresh state reports the open incident once more: a repeated comment, never a missed alert.
  await watch(fake, readState(undefined), NOW + 40 * MINUTE);
  expect(sent(ERRORS, 'keep')).toHaveLength(2);
});
