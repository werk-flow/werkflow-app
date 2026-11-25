import { afterEach, beforeEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  CHECK_APP_CONFIG,
  checkRunOf,
  finishCheckRun,
  postCheckRun,
  queuedCheckRunOf,
  readHandoff,
} from './check-app';
import { z } from 'zod';
import type { CiResult } from './results';

const repositoryRoot = resolve(import.meta.dir, '../../..');
const APP = 4242;
const OTHER_APP = 999;
const TOKEN = 'ghs_installation-token-under-test';

let stub = '';

beforeEach(() => {
  stub = mkdtempSync(join(tmpdir(), 'check-app-'));
});

afterEach(() => rmSync(stub, { recursive: true, force: true }));

const RUN_URL = 'https://ci.test/run/7';
const COMMIT = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const TREE = 'c'.repeat(40);

function result(overrides: Partial<CiResult>): CiResult {
  return {
    version: 1,
    job: 'check',
    shard: null,
    event: 'pr',
    tree: 'c'.repeat(40),
    commit: COMMIT,
    base: null,
    status: 'passed',
    groups: [],
    planReason: 'Selection by diff.',
    reusedFrom: null,
    listGrowthApproved: false,
    producer: 'mac',
    runUrl: RUN_URL,
    attempt: 2,
    startedAt: '2026-11-21T09:00:00.000Z',
    completedAt: '2026-11-21T09:05:00.000Z',
    ...overrides,
  };
}

const build = (
  check: CiResult | { unreadable: string },
  scheduled: Partial<Parameters<typeof checkRunOf>[0]['scheduled']> = {},
) =>
  checkRunOf({
    check,
    plan: result({ job: 'plan', startedAt: '2026-11-21T08:00:00.000Z' }),
    tree: TREE,
    scheduled: { runUrl: RUN_URL, attempt: 2, event: 'pr', commit: COMMIT, prHead: undefined, ...scheduled },
    now: new Date('2026-11-21T10:00:00.000Z'),
  });

test('a check run passes only a finished, passed Check of this run from a CI runner, on the tested commit', () => {
  expect(build(result({}))).toEqual({
    request: {
      name: 'Check',
      head_sha: COMMIT,
      status: 'completed',
      started_at: '2026-11-21T08:00:00.000Z',
      completed_at: '2026-11-21T09:05:00.000Z',
      conclusion: 'success',
      details_url: RUN_URL,
      external_id: `${RUN_URL} attempt 2`,
      output: {
        title: 'Passed',
        summary: `Selection by diff.\n\nRun: ${RUN_URL}\nTree: ${'c'.repeat(40)}\nRunner: mac`,
      },
    },
  });
  const conclusion = (check: CiResult) => {
    const built = build(check);
    if (!('request' in built)) return built.problem;
    return built.request.status === 'completed' ? built.request.conclusion : built.request.status;
  };
  expect(conclusion(result({ status: 'failed' }))).toBe('failure');
  expect(conclusion(result({ status: 'running', completedAt: null }))).toBe('failure');
  expect(conclusion(result({ producer: null }))).toBe('failure');
  // A pass of the scheduled run and commit from another tree than the runner checked out never succeeds.
  expect(conclusion(result({ tree: 'd'.repeat(40) }))).toBe('failure');
  const full = build(result({ event: 'full' }), { event: 'full' });
  expect('request' in full && full.request.name).toBe('Full run / Check');
});

test("a result of another run, job, event or commit than the scheduler's posts nothing", () => {
  expect(build({ unreadable: 'check.json is missing' })).toEqual({ problem: 'check.json is missing' });
  expect(build(result({ runUrl: 'https://ci.test/run/6' }))).toHaveProperty('problem');
  expect(build(result({ job: 'fast' }))).toHaveProperty('problem');
  // A job cannot make a pull request's run post `Full run / Check`, or post on another commit.
  expect(build(result({ event: 'full' }))).toHaveProperty('problem');
  expect(build(result({ commit: HEAD }))).toHaveProperty('problem');
  // The scheduler's PR head under its merge commit takes the check run; only a pull request has one.
  const merged = build(result({}), { prHead: HEAD });
  expect('request' in merged && merged.request.head_sha).toBe(HEAD);
  expect(build(result({ event: 'main' }), { event: 'main', prHead: HEAD })).toHaveProperty('problem');
  expect(build(result({}), { prHead: 'not-a-commit' })).toHaveProperty('problem');
});

test("a rerun never posts an earlier attempt's result: the attempt must be the scheduler's", () => {
  // Attempt 2's Check died before it wrote check.json, so attempt 1's green result is still there.
  expect(build(result({ attempt: 1 }))).toHaveProperty('problem');
  expect(build(result({ attempt: undefined }))).toHaveProperty('problem');
});

test("an accepted run first withdraws every earlier result on its head, so a draft's green fast tier never lands a ready PR", () => {
  const scheduled = {
    runUrl: RUN_URL,
    attempt: 1,
    event: 'integration' as const,
    commit: COMMIT,
    prHead: undefined,
  };
  expect(queuedCheckRunOf(scheduled)).toEqual({
    request: {
      name: 'Check',
      head_sha: COMMIT,
      status: 'queued',
      details_url: RUN_URL,
      external_id: `${RUN_URL} attempt 1`,
      output: {
        title: 'Waiting',
        summary: `The integration run waits or runs; until it ends, no earlier result counts.\n\nRun: ${RUN_URL}`,
      },
    },
  });
  // A dead full run's queued check would hold main's full runs back, so a full run posts none.
  expect(queuedCheckRunOf({ ...scheduled, event: 'full' })).toBeUndefined();
  expect(queuedCheckRunOf({ ...scheduled, prHead: HEAD })).toHaveProperty('problem');
  const pr = queuedCheckRunOf({ ...scheduled, event: 'pr', prHead: HEAD });
  expect(pr && 'request' in pr && pr.request.head_sha).toBe(HEAD);
});

type Stored = {
  id: number;
  name: string;
  head_sha: string;
  status: 'queued' | 'completed';
  conclusion: string | null;
  external_id: string | null;
  app: { id: number };
};

const OWN = `${RUN_URL} attempt 2`;
const NEWER_RUN = { runUrl: 'https://ci.test/run/8', attempt: 1 };
const NEWER = `${NEWER_RUN.runUrl} attempt 1`;
const start = (id: number, external_id: string | null, overrides: Partial<Stored> = {}): Stored => ({
  id,
  name: 'Check',
  head_sha: COMMIT,
  status: 'queued',
  conclusion: null,
  external_id,
  app: { id: APP },
  ...overrides,
});

/**
 * A fake GitHub that holds `runs` for every App, as GitHub's app filter may let another through: it
 * lists a commit's check runs of a name in pages, creates and updates them, and records each request.
 */
function fakeGitHub(
  runs: Stored[],
  options: { listStatus?: number; listBody?: string; beforeWrite?: () => void } = {},
) {
  const asked: { method: string; url: string; body: unknown }[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    const method = init.method ?? 'GET';
    const body: unknown = init.body === undefined ? undefined : JSON.parse(String(init.body));
    asked.push({ method, url, body });
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
    const { pathname, searchParams } = new URL(url);
    if (method === 'GET') {
      const listed = runs.filter(
        (run) => run.head_sha === pathname.split('/')[5] && run.name === searchParams.get('check_name'),
      );
      const page = Number(searchParams.get('page'));
      return new Response(
        options.listBody ??
          JSON.stringify({
            total_count: listed.length,
            check_runs: listed.slice((page - 1) * 100, page * 100),
          }),
        { status: options.listStatus ?? 200 },
      );
    }
    options.beforeWrite?.();
    const sent = z
      .object({
        name: z.string(),
        head_sha: z.string().optional(),
        status: z.enum(['queued', 'completed']),
        conclusion: z.string().optional(),
        external_id: z.string(),
      })
      .parse(body);
    if (method === 'POST') {
      const created = start(Math.max(0, ...runs.map(({ id }) => id)) + 1, sent.external_id, {
        name: sent.name,
        head_sha: sent.head_sha ?? '',
        status: sent.status,
        conclusion: sent.conclusion ?? null,
      });
      runs.push(created);
      return Response.json(created, { status: 201 });
    }
    const updated = runs.find(({ id }) => `/repos/owner/repo/check-runs/${id}` === pathname);
    if (!updated) return new Response('{}', { status: 404 });
    Object.assign(updated, {
      name: sent.name,
      status: sent.status,
      conclusion: sent.conclusion ?? null,
      external_id: sent.external_id,
    });
    return Response.json(updated);
  };
  /** What GitHub shows as the App's Check on `sha`: its newest check run of that name. */
  const newestCheck = (sha = COMMIT) =>
    runs
      .filter((run) => run.name === 'Check' && run.head_sha === sha && run.app.id === APP)
      .toSorted((one, other) => other.id - one.id)[0];
  const writes = () => asked.filter(({ method }) => method !== 'GET');
  return { fetch, asked, writes, newestCheck };
}

/** Finishes a run through `github`: by default this file's run, attempt 2 of a `pr` run on COMMIT. */
function finish(
  github: ReturnType<typeof fakeGitHub>,
  run: { runUrl: string; attempt: number } = { runUrl: RUN_URL, attempt: 2 },
  scheduled: Partial<Parameters<typeof build>[1]> = {},
) {
  const built = build(result({ ...run, ...(scheduled.event ? { event: scheduled.event } : {}) }), {
    ...run,
    ...scheduled,
  });
  if (!('request' in built)) throw new Error(built.problem);
  return finishCheckRun({
    request: built.request,
    scheduled: { event: 'pr', commit: COMMIT, prHead: undefined, ...run, ...scheduled },
    appId: APP,
    token: TOKEN,
    repository: 'owner/repo',
    fetch: github.fetch,
  });
}

test("a run's finish completes its own start, so a newer start always stays the commit's newest Check", async () => {
  const github = fakeGitHub([
    start(5, NEWER, { status: 'completed', conclusion: 'success' }),
    start(10, OWN),
  ]);
  expect(await finish(github)).toEqual({ id: 10 });
  expect(github.asked[0]?.url).toBe(
    `https://api.github.com/repos/owner/repo/commits/${COMMIT}/check-runs?check_name=Check&app_id=${APP}&filter=all&per_page=100&page=1`,
  );
  // It updates the start it found, keeps the start's commit and never creates a check run.
  expect(github.writes()).toHaveLength(1);
  expect(github.writes()[0]?.method).toBe('PATCH');
  expect(github.writes()[0]?.url).toBe('https://api.github.com/repos/owner/repo/check-runs/10');
  expect(github.writes()[0]?.body).not.toHaveProperty('head_sha');
  expect(github.newestCheck()).toMatchObject({ id: 10, status: 'completed', conclusion: 'success' });
  // A pull request's run reads and completes its start on the head it posts on.
  const merged = fakeGitHub([start(10, OWN, { head_sha: HEAD })]);
  expect(await finish(merged, undefined, { prHead: HEAD })).toEqual({ id: 10 });
  expect(merged.asked[0]?.url).toContain(`/commits/${HEAD}/check-runs?`);
  expect(merged.newestCheck(HEAD)).toMatchObject({ id: 10, conclusion: 'success' });
});

test("an older run's finish after a newer start creates no check run and never posts its pass as the newest", async () => {
  // An older fast-tier run after the integration run's start, and attempt 2 of a run after attempt 3 started.
  for (const newer of [NEWER, `${RUN_URL} attempt 3`]) {
    const github = fakeGitHub([start(10, OWN), start(12, newer)]);
    expect(await finish(github), newer).toEqual({
      problem: `a newer run (${newer}) owns Check on ${COMMIT}; this run's verdict no longer counts`,
    });
    expect(github.writes(), newer).toEqual([]);
    expect(github.newestCheck(), newer).toMatchObject({ id: 12, status: 'queued' });
  }
  // A newer start that lands between the ownership read and the write: the older run completes its
  // own, older check run, so the newer run's queued Check stays the newest.
  const runs = [start(10, OWN)];
  const raced = fakeGitHub(runs, { beforeWrite: () => runs.push(start(12, NEWER)) });
  expect(await finish(raced)).toEqual({ id: 10 });
  expect(raced.writes().map(({ method }) => method)).toEqual(['PATCH']);
  expect(raced.newestCheck()).toMatchObject({ id: 12, status: 'queued', conclusion: null });
});

test("a completed newer start still blocks an older run's finish, so finishing the newest run never revives an older one", async () => {
  const github = fakeGitHub([start(10, OWN), start(12, NEWER)]);
  expect(await finish(github, NEWER_RUN)).toEqual({ id: 12 });
  expect(github.newestCheck()).toMatchObject({ id: 12, status: 'completed', conclusion: 'success' });
  expect(await finish(github)).toHaveProperty('problem');
  expect(github.writes()).toHaveLength(1);
  expect(github.newestCheck()).toMatchObject({ id: 12, external_id: NEWER });
});

test('a run without its own start on the commit refuses to finish and writes nothing', async () => {
  for (const runs of [
    [],
    [start(4, null)],
    // Another App's check run with this run's identity is no start of it.
    [start(10, OWN, { app: { id: OTHER_APP } })],
    // A start of this run on another commit.
    [start(10, OWN, { head_sha: HEAD })],
  ]) {
    const github = fakeGitHub(runs);
    expect(await finish(github), JSON.stringify(runs)).toHaveProperty('problem');
    expect(github.writes(), JSON.stringify(runs)).toEqual([]);
  }
});

test('the ownership read follows every page and refuses an answer it cannot read', async () => {
  const older = Array.from({ length: 100 }, (_, index) => start(index + 1, NEWER));
  const paged = fakeGitHub([...older, start(200, OWN)]);
  expect(await finish(paged)).toEqual({ id: 200 });
  expect(
    paged.asked
      .filter(({ method }) => method === 'GET')
      .map(({ url }) => new URL(url).searchParams.get('page')),
  ).toEqual(['1', '2']);
  // Exactly the most a read takes: the tenth page completes the count, so no eleventh is asked.
  const most = fakeGitHub([
    ...Array.from({ length: 999 }, (_, index) => start(index + 1, NEWER)),
    start(1000, OWN),
  ]);
  expect(await finish(most)).toEqual({ id: 1000 });
  expect(most.asked.filter(({ method }) => method === 'GET')).toHaveLength(10);
  const newerOnLastPage = fakeGitHub([start(150, OWN), ...older.slice(1), start(300, NEWER)]);
  expect(await finish(newerOnLastPage)).toHaveProperty('problem');
  // Another app's check run counts for nothing, even when GitHub's filter let it through.
  expect(await finish(fakeGitHub([start(10, OWN), start(12, NEWER, { app: { id: OTHER_APP } })]))).toEqual({
    id: 10,
  });
  for (const unreadable of [
    { listStatus: 500 },
    { listStatus: 401, listBody: JSON.stringify({ message: `Bad credentials ${TOKEN}` }) },
    { listBody: 'not json' },
    { listBody: JSON.stringify({ total_count: 1, check_runs: [{ id: 'ten' }] }) },
    // GitHub promises a second page that never comes.
    { listBody: JSON.stringify({ total_count: 2, check_runs: [start(10, OWN)] }) },
  ]) {
    const github = fakeGitHub([start(10, OWN)], unreadable);
    const refused = await finish(github);
    expect(refused, JSON.stringify(unreadable)).toHaveProperty('problem');
    expect(JSON.stringify(refused)).not.toContain(TOKEN);
    expect(github.writes(), JSON.stringify(unreadable)).toEqual([]);
  }
  const thrown = fakeGitHub([]);
  thrown.fetch = () => Promise.reject(new TypeError('network down'));
  expect(await finish(thrown)).toEqual({ problem: 'the check runs could not be read (TypeError)' });
});

test("a finish refuses GitHub's answer when it is not this run's start from the configured App", async () => {
  for (const answered of [{ id: 11 }, { app: { id: OTHER_APP } }]) {
    const github = fakeGitHub([start(10, OWN)]);
    const fetch = github.fetch;
    const completed = start(10, OWN, { status: 'completed', conclusion: 'success' });
    github.fetch = (url, init) =>
      init.method === 'PATCH'
        ? Promise.resolve(Response.json({ ...completed, ...answered }))
        : fetch(url, init);
    expect(await finish(github), JSON.stringify(answered)).toHaveProperty('problem');
  }
});

test('a full run, which posts no start, creates its verdict without an ownership read', async () => {
  const github = fakeGitHub([start(12, NEWER)]);
  expect(await finish(github, undefined, { event: 'full' })).toEqual({ id: 13 });
  expect(github.asked.map(({ method, url }) => `${method} ${url}`)).toEqual([
    'POST https://api.github.com/repos/owner/repo/check-runs',
  ]);
});

test('a handed-over result is read only from a regular file, and no message shows what an unreadable one holds', () => {
  const secret = '-----BEGIN RSA PRIVATE KEY----- MIIEsecret';
  const key = join(stub, 'key.pem');
  writeFileSync(key, secret);
  const results = join(stub, 'handoff');
  mkdirSync(results);
  const valid = join(results, 'valid.json');
  writeFileSync(valid, JSON.stringify(result({})));
  expect(readHandoff(valid)).toEqual(result({}));
  const linked = join(results, 'check.json');
  symlinkSync(key, linked);
  const malformed = join(results, 'malformed.json');
  writeFileSync(malformed, `{"job": "${secret}"}`);
  const large = join(results, 'large.json');
  writeFileSync(large, `${JSON.stringify(result({}))}${' '.repeat(1024 * 1024)}`);
  const pipe = join(results, 'pipe.json');
  expect(spawnSync('mkfifo', [pipe]).status).toBe(0);
  for (const path of [linked, malformed, large, pipe, join(results, 'missing.json')]) {
    const read = readHandoff(path);
    expect(read, path).toHaveProperty('unreadable');
    expect(JSON.stringify(read), path).not.toContain('BEGIN');
  }
});

function request() {
  const built = build(result({}));
  if (!('request' in built)) throw new Error(built.problem);
  return built.request;
}

/** Posts through a fake GitHub that answers `answer` with `status`, and records what it was sent. */
async function post(answer: unknown, status = 201, asked = request()) {
  const sent: { url: string; init: RequestInit }[] = [];
  const posted = await postCheckRun({
    request: asked,
    appId: APP,
    token: TOKEN,
    repository: 'owner/repo',
    fetch: async (url, init) => {
      sent.push({ url, init });
      return new Response(JSON.stringify(answer), {
        status,
        headers: { 'x-github-request-id': 'R1' },
      });
    },
  });
  return { posted, sent };
}

const answer = (appId: number) => ({
  id: 77,
  name: 'Check',
  head_sha: COMMIT,
  conclusion: 'success',
  app: { id: appId, slug: 'werkflow-ci' },
});

test('the publisher posts as the configured App and fails when GitHub holds the check run from another', async () => {
  const { posted, sent } = await post(answer(APP));
  expect(posted).toEqual({ id: 77 });
  expect(sent).toHaveLength(1);
  expect(sent[0]?.url).toBe('https://api.github.com/repos/owner/repo/check-runs');
  expect(new Headers(sent[0]?.init.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
  expect(JSON.parse(String(sent[0]?.init.body))).toEqual(request());
  const other = await post(answer(OTHER_APP));
  expect(other.posted).toHaveProperty('problem');
  expect(JSON.stringify(other.posted)).toContain(`App ${OTHER_APP}`);
  const queued = queuedCheckRunOf({
    runUrl: RUN_URL,
    attempt: 1,
    event: 'pr',
    commit: COMMIT,
    prHead: undefined,
  });
  if (!queued || !('request' in queued)) throw new Error('no queued check run');
  expect((await post({ ...answer(APP), conclusion: null }, 201, queued.request)).posted).toEqual({ id: 77 });
  expect((await post(answer(APP), 201, queued.request)).posted).toHaveProperty('problem');
});

test("a refused request names GitHub's status and request id, never the token or GitHub's body", async () => {
  const { posted } = await post({ message: `Bad credentials ${TOKEN}` }, 401);
  expect(posted).toEqual({ problem: 'GitHub answered 401 (request R1)' });
});

/**
 * The publisher as a trusted copy whose configuration names `config`: the script and its runner
 * module copied, the library and dependencies linked, since the publisher reads the file only from
 * its own copy.
 */
function publisherCopy(config: string): string {
  const copy = join(stub, 'trusted');
  rmSync(copy, { recursive: true, force: true });
  mkdirSync(join(copy, 'scripts/ci'), { recursive: true });
  mkdirSync(join(copy, '.github/scripts'), { recursive: true });
  for (const name of ['publish-check.ts', 'run.ts'])
    copyFileSync(join(repositoryRoot, 'scripts/ci', name), join(copy, 'scripts/ci', name));
  for (const name of ['lib', 'node_modules']) symlinkSync(join(repositoryRoot, name), join(copy, name));
  writeFileSync(join(copy, CHECK_APP_CONFIG), config);
  return join(copy, 'scripts/ci/publish-check.ts');
}

test("the publisher posts nothing for another run's Check and prints no token", () => {
  const results = join(stub, 'results');
  mkdirSync(results);
  writeFileSync(join(results, 'check.json'), JSON.stringify(result({ runUrl: 'https://ci.test/run/6' })));
  const finish = (script: string, env: Record<string, string> = {}) =>
    spawnSync(process.execPath, [script, 'finish'], {
      encoding: 'utf8',
      env: {
        NODE_ENV: 'test',
        PATH: process.env.PATH,
        CI_RESULTS_DIR: results,
        CI_RUN_URL: RUN_URL,
        CI_RUN_ATTEMPT: '2',
        CI_EVENT: 'pr',
        CI_COMMIT: COMMIT,
        CI_TREE: TREE,
        CI_CHECK_APP_TOKEN: TOKEN,
        GITHUB_REPOSITORY: 'owner/repo',
        ...env,
      },
    });
  // With an App configured, it reads the result and refuses it before any request.
  const foreign = finish(publisherCopy(`{"appId": ${APP}}`));
  expect(foreign.status).toBe(1);
  expect(foreign.stderr).toContain(
    'No check run is posted: the Check result is of the pr run https://ci.test/run/6',
  );
  expect(foreign.stdout + foreign.stderr).not.toContain(TOKEN);
  // Without the scheduled tree, a finish cannot tell the tested tree, so it posts nothing.
  const treeless = finish(publisherCopy(`{"appId": ${APP}}`), { CI_TREE: '' });
  expect(treeless.status).toBe(1);
  expect(treeless.stderr).toContain('CI_TREE');
  // Without one, it stops at its configuration.
  const unconfigured = finish(publisherCopy('{"appId": null}'));
  expect(unconfigured.status).toBe(1);
  expect(unconfigured.stderr).toContain('names no CI App yet');
  expect(unconfigured.stdout + unconfigured.stderr).not.toContain(TOKEN);
});
