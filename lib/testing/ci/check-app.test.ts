import { afterEach, beforeEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
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
import {
  CHECK_APP_CONFIG,
  checkRunOf,
  postCheckRun,
  queuedCheckRunOf,
  readCheckApp,
  readHandoff,
} from './check-app';
import type { CiResult } from './results';
import { readWorkflow } from '../ci-workflow';

const repositoryRoot = resolve(import.meta.dir, '../../..');
const APP = 4242;
const OTHER_APP = 999;
const TOKEN = 'ghs_installation-token-under-test';

let stub = '';

beforeEach(() => {
  stub = mkdtempSync(join(tmpdir(), 'check-app-'));
});

afterEach(() => rmSync(stub, { recursive: true, force: true }));

// The gates and their helper, copied beside a configuration of the test's choice: check-app.sh reads
// the file next to itself, and nothing else can point a gate at another file.
function gates(config: string | undefined) {
  const scripts = join(stub, 'scripts');
  mkdirSync(scripts, { recursive: true });
  for (const name of ['check-app.sh', 'release-candidate.sh', 'main-full-run.sh'])
    copyFileSync(join(repositoryRoot, '.github/scripts', name), join(scripts, name));
  rmSync(join(scripts, 'check-app.json'), { force: true });
  if (config !== undefined) writeFileSync(join(scripts, 'check-app.json'), config);
  return scripts;
}

const CONFIGS: readonly { config: string | undefined; appId: number | null | 'refused' }[] = [
  { config: '{\n  "appId": null\n}\n', appId: null },
  { config: `{"appId": ${APP}}`, appId: APP },
  { config: undefined, appId: 'refused' },
  { config: '', appId: 'refused' },
  { config: 'null', appId: 'refused' },
  { config: '{}', appId: 'refused' },
  { config: `[${APP}]`, appId: 'refused' },
  { config: '{"appId": 0}', appId: 'refused' },
  { config: '{"appId": -3}', appId: 'refused' },
  { config: '{"appId": 1.5}', appId: 'refused' },
  { config: `{"appId": "${APP}"}`, appId: 'refused' },
  { config: '{"appId": true}', appId: 'refused' },
  { config: '{"appId": 1234567890123456}', appId: 'refused' },
  { config: `{"appId": ${APP}, "slug": "werkflow-ci"}`, appId: 'refused' },
  { config: `{"appId": ${APP}} {"appId": ${OTHER_APP}}`, appId: 'refused' },
  { config: `{"appId": ${APP}`, appId: 'refused' },
  // Lenient parsers read these as numbers; the readers take only the canonical digits.
  { config: '{"appId": +42}', appId: 'refused' },
  { config: '{"appId": 042}', appId: 'refused' },
  { config: '{"appId": 42.0}', appId: 'refused' },
  { config: '{"appId": 4e3}', appId: 'refused' },
  // Bash drops NUL bytes from a command's output; the shell reader must not read 4242 here.
  { config: '{"appId": 42\u000042}', appId: 'refused' },
];

test('the gates and the publisher read the same App from the configuration, and refuse a missing or malformed one', () => {
  // The committed file holds one of the two forms: null until the App exists, then its id.
  expect(readCheckApp(join(repositoryRoot, CHECK_APP_CONFIG))).toHaveProperty('appId');
  for (const { config, appId } of CONFIGS) {
    const scripts = gates(config);
    const typescript = readCheckApp(join(scripts, 'check-app.json'));
    const shell = spawnSync(
      'bash',
      [
        '-c',
        'set -euo pipefail; source "$1"; check_app_id || exit 1; echo "id=${CHECK_APP_ID}"',
        '_',
        join(scripts, 'check-app.sh'),
      ],
      { encoding: 'utf8' },
    );
    if (appId === 'refused') {
      expect('problem' in typescript, String(config)).toBe(true);
      expect(shell.status, String(config)).not.toBe(0);
      expect(shell.stdout, String(config)).toContain('::error::');
    } else {
      expect(typescript, String(config)).toEqual({ appId });
      expect(shell.status, String(config)).toBe(0);
      expect(shell.stdout, String(config)).toBe(`id=${appId ?? ''}\n`);
    }
  }
});

// Answers like gh: `--jq` runs through real jq, so the gates' own filters are under test. Every
// endpoint answers its whole file whatever the query asks, so only the filters choose.
const GH_STUB = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB/gh.log"
filter=.
previous=
for argument in "$@"; do
  if test "$previous" = --jq; then filter="$argument"; fi
  previous="$argument"
done
case "$*" in
  *'/check-runs?'*) jq -r "$filter" "$STUB/check-runs.json" ;;
  *'/statuses'* | *'/status?'*) jq -r "$filter" "$STUB/statuses.json" ;;
  *'actions/runs?'*) jq -r "$filter" "$STUB/runs.json" ;;
  *'/jobs?'*) jq -r "$filter" "$STUB/jobs.json" ;;
  *'/commits?'*) jq -r "$filter" "$STUB/commits.json" ;;
  *) exit 1 ;;
esac
`;
const BUN_STUB = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB/bun.log"
echo '{"run":true,"reason":"stub"}'
`;

type CheckRunFixture = { app: { id: number; slug: string }; name: string; conclusion: string };

/** The check runs on the commit, as GitHub lists them, and a green commit status of the same name. */
function writeSources(checkRuns: readonly CheckRunFixture[]) {
  for (const [name, body] of [
    ['gh', GH_STUB],
    ['bun', BUN_STUB],
  ] as const) {
    writeFileSync(join(stub, name), body);
    chmodSync(join(stub, name), 0o755);
  }
  writeFileSync(
    join(stub, 'check-runs.json'),
    JSON.stringify({
      check_runs: checkRuns.map((run, index) => ({
        ...run,
        status: 'completed',
        started_at: '2026-11-21T08:00:00Z',
        completed_at: `2026-11-21T09:0${index}:00Z`,
        html_url: `https://github.test/check/${index}`,
        details_url: `https://ci.test/run/${index}`,
      })),
    }),
  );
  // A plain commit status has no app: anyone who may write statuses can post it.
  writeFileSync(
    join(stub, 'statuses.json'),
    JSON.stringify([{ context: 'Full run / Check', state: 'success', creator: { login: 'someone' } }]),
  );
  writeFileSync(join(stub, 'runs.json'), JSON.stringify({ workflow_runs: [] }));
  writeFileSync(join(stub, 'jobs.json'), JSON.stringify({ jobs: [] }));
  writeFileSync(join(stub, 'gh.log'), '');
  writeFileSync(join(stub, 'bun.log'), '');
  writeFileSync(join(stub, 'output'), '');
}

const fromApp = (id: number, conclusion = 'success'): CheckRunFixture => ({
  app: { id, slug: id === APP ? 'werkflow-ci' : 'another-app' },
  name: 'Full run / Check',
  conclusion,
});
const fromActions: CheckRunFixture = {
  app: { id: 15368, slug: 'github-actions' },
  name: 'Full run / Check',
  conclusion: 'success',
};

const gateEnv = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'test',
  PATH: `${stub}:${process.env.PATH}`,
  STUB: stub,
  GH_TOKEN: 'token',
  GITHUB_REPOSITORY: 'owner/repo',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_OUTPUT: join(stub, 'output'),
});

/** The release decision for a main one commit ahead of production, under `config`. */
function release(config: string | undefined, checkRuns: readonly CheckRunFixture[]) {
  writeSources(checkRuns);
  const scripts = gates(config);
  const repository = join(stub, 'repository');
  rmSync(repository, { recursive: true, force: true });
  const git = (...args: string[]) =>
    spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', ...args], {
      cwd: repository,
      encoding: 'utf8',
    });
  spawnSync('git', ['init', '-qb', 'main', repository]);
  git('commit', '--allow-empty', '-qm', 'shipped');
  git('update-ref', 'refs/remotes/origin/production', 'HEAD');
  git('commit', '--allow-empty', '-qm', 'new');
  const result = spawnSync('bash', [join(scripts, 'release-candidate.sh'), 'scheduled'], {
    cwd: repository,
    encoding: 'utf8',
    env: gateEnv(),
  });
  return {
    status: result.status,
    stdout: result.stdout,
    outputs: readFileSync(join(stub, 'output'), 'utf8').trim().split('\n').filter(Boolean),
    calls: readFileSync(join(stub, 'gh.log'), 'utf8'),
  };
}

test("the release counts the configured App's full run beside GitHub Actions', and the newest decides", () => {
  const green = release(`{"appId": ${APP}}`, [fromApp(APP)]);
  expect(green.status).toBe(0);
  expect(green.outputs).toContain('verified=true');
  expect(green.stdout).toContain('success https://ci.test/run/0');
  // A later red run of the App replaces its pass.
  const red = release(`{"appId": ${APP}}`, [fromApp(APP), fromApp(APP, 'failure')]);
  expect(red.outputs).toContain('skip=red-run');
  expect(red.outputs.join('\n')).toContain('ended failure: https://ci.test/run/1');
});

test("the release refuses another app's check run, a plain commit status and, without a configured App, the App's own", () => {
  const configured = `{"appId": ${APP}}`;
  // Another app, and an Actions check run outside the release's own workflows, name the same check.
  const others = release(configured, [fromApp(OTHER_APP), fromActions]);
  expect(others.status).toBe(0);
  expect(others.outputs).toContain('verified=false');
  // The gate never reads commit statuses.
  expect(others.calls).not.toMatch(/\/status/);
  const unconfigured = release('{"appId": null}', [fromApp(APP)]);
  expect(unconfigured.outputs).toContain('verified=false');
  expect(unconfigured.calls).not.toContain('/check-runs');
});

test('the release stops before any decision on a missing or malformed configuration', () => {
  for (const config of [undefined, `{"appId": "${APP}"}`, '']) {
    const result = release(config, [fromApp(APP)]);
    expect(result.status, String(config)).not.toBe(0);
    expect(result.stdout, String(config)).toContain('names no CI App');
    expect(result.outputs, String(config)).toEqual([]);
    expect(result.calls, String(config)).toBe('');
  }
});

/** What main-full-run.sh decide passes to the repository's rule, for a full run on main's second commit. */
function fullRunDecision(config: string | undefined, checkRuns: readonly CheckRunFixture[]) {
  writeSources(checkRuns);
  const scripts = gates(config);
  const commits = ['c0', 'c1'].map((sha) => ({ sha: sha.padEnd(40, '0'), commit: { message: sha } }));
  writeFileSync(join(stub, 'commits.json'), JSON.stringify(commits));
  const result = spawnSync('bash', [join(scripts, 'main-full-run.sh'), 'decide'], {
    encoding: 'utf8',
    env: { ...gateEnv(), GITHUB_SHA: 'c0'.padEnd(40, '0') },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    rule: readFileSync(join(stub, 'bun.log'), 'utf8').trim(),
  };
}

test("main's full-run decision counts the configured App's full run and refuses every other source", () => {
  const started = Date.parse('2026-11-21T08:00:00Z') / 1000;
  const counted = fullRunDecision(`{"appId": ${APP}}`, [fromApp(APP)]);
  expect(counted.status).toBe(0);
  // c0 has the same answer as c1: the stub lists the check runs for every commit, so c0 decides first.
  expect(counted.rule).toBe(`scripts/ci/full-run.ts due --run ${'c0'.padEnd(40, '0')},${started},ended`);
  expect(fullRunDecision(`{"appId": ${APP}}`, [fromApp(OTHER_APP)]).rule).toBe('scripts/ci/full-run.ts due');
  expect(fullRunDecision('{"appId": null}', [fromApp(APP)]).rule).toBe('scripts/ci/full-run.ts due');
  // GitHub Actions stays trusted with or without the App.
  expect(fullRunDecision(`{"appId": ${APP}}`, [fromActions]).rule).toContain('--run');
  for (const config of [undefined, '{"appId": 0}']) {
    const refused = fullRunDecision(config, [fromApp(APP)]);
    expect(refused.status, String(config)).not.toBe(0);
    expect(refused.stdout, String(config)).toContain('names no CI App');
    expect(refused.rule, String(config)).toBe('');
  }
});

const RUN_URL = 'https://ci.test/run/7';
const COMMIT = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);

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
      output: {
        title: 'Waiting',
        summary: `The integration run waits or runs; until it ends, no earlier result counts.\n\nRun: ${RUN_URL}`,
      },
    },
  });
  const full = queuedCheckRunOf({ ...scheduled, event: 'full' });
  expect('request' in full && full.request.name).toBe('Full run / Check');
  expect(queuedCheckRunOf({ ...scheduled, prHead: HEAD })).toHaveProperty('problem');
  const pr = queuedCheckRunOf({ ...scheduled, event: 'pr', prHead: HEAD });
  expect('request' in pr && pr.request.head_sha).toBe(HEAD);
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
  writeFileSync(large, ' '.repeat(1024 * 1024 + 1));
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
  if (!('request' in queued)) throw new Error(queued.problem);
  expect((await post({ ...answer(APP), conclusion: null }, 201, queued.request)).posted).toEqual({ id: 77 });
  expect((await post(answer(APP), 201, queued.request)).posted).toHaveProperty('problem');
});

test("a refused request names GitHub's status and request id, never the token or GitHub's body", async () => {
  const { posted } = await post({ message: `Bad credentials ${TOKEN}` }, 401);
  expect(posted).toEqual({ problem: 'GitHub answered 401 (request R1)' });
});

test("the publisher posts nothing for another run's Check and prints no token", () => {
  const results = join(stub, 'results');
  mkdirSync(results);
  writeFileSync(join(results, 'check.json'), JSON.stringify(result({ runUrl: 'https://ci.test/run/6' })));
  const run = spawnSync(process.execPath, [join(repositoryRoot, 'scripts/ci/publish-check.ts'), 'finish'], {
    encoding: 'utf8',
    env: {
      NODE_ENV: 'test',
      PATH: process.env.PATH,
      CI_RESULTS_DIR: results,
      CI_RUN_URL: RUN_URL,
      CI_RUN_ATTEMPT: '2',
      CI_EVENT: 'pr',
      CI_COMMIT: COMMIT,
      CI_CHECK_APP_TOKEN: TOKEN,
      GITHUB_REPOSITORY: 'owner/repo',
    },
  });
  expect(run.status).not.toBe(0);
  // Before the App exists the publisher stops at its configuration, after that at the foreign result.
  expect(run.stderr).toMatch(
    /names no CI App yet|No check run is posted: the Check result is of the pr run https:\/\/ci\.test\/run\/6/,
  );
  expect(run.stdout + run.stderr).not.toContain(TOKEN);
});

test('the gate jobs may read check runs, so a configured App is not refused by GitHub', () => {
  expect(readWorkflow('release.yml').at('jobs', 'candidate', 'permissions')).toEqual({
    contents: 'read',
    actions: 'read',
    checks: 'read',
  });
  const fullRun = readWorkflow('main-full-run.yml');
  expect(fullRun.at('jobs', 'decide', 'permissions')).toMatchObject({ checks: 'read' });
  expect(fullRun.at('jobs', 'alert', 'permissions')).toMatchObject({ checks: 'read' });
});
