// The release and full-run gates read the CI App from .github/scripts/check-app.json and count only
// GitHub Actions and that App's check runs (.github/scripts/release-candidate.sh, main-full-run.sh).
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CHECK_APP_CONFIG, readCheckApp } from './check-app';
import { readWorkflow } from '../ci-workflow';

const repositoryRoot = resolve(import.meta.dir, '../../..');
const APP = 4242;
const OTHER_APP = 999;

let stub = '';

beforeEach(() => {
  stub = mkdtempSync(join(tmpdir(), 'check-app-gates-'));
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

type CheckRunFixture = {
  app: { id: number; slug: string };
  name: string;
  conclusion: string | null;
  status?: 'completed' | 'in_progress';
  completed_at?: string;
};

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
        status: 'completed',
        started_at: '2026-11-21T08:00:00Z',
        completed_at: `2026-11-21T09:0${index}:00Z`,
        html_url: `https://github.test/check/${index}`,
        details_url: `https://ci.test/run/${index}`,
        ...run,
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

/**
 * The release decision for a main one commit ahead of production, under `config`. `actionsCheck`
 * adds a nightly run on GitHub Actions whose `Full run / Check` job ended as given.
 */
function release(
  config: string | undefined,
  checkRuns: readonly CheckRunFixture[],
  actionsCheck?: { conclusion: string; completed_at: string },
) {
  writeSources(checkRuns);
  if (actionsCheck) {
    const nightly = { id: 1, head_branch: 'main', path: '.github/workflows/nightly.yml', event: 'schedule' };
    writeFileSync(join(stub, 'runs.json'), JSON.stringify({ workflow_runs: [nightly] }));
    const job = { name: 'Full run / Check', status: 'completed', html_url: 'https://github.test/actions/1' };
    writeFileSync(join(stub, 'jobs.json'), JSON.stringify({ jobs: [{ ...job, ...actionsCheck }] }));
  }
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

test('a later full run that ends in the same second as a pass never lets the release reuse green', () => {
  const second = '2026-11-21T09:00:00Z';
  const tie = release(
    `{"appId": ${APP}}`,
    [fromApp(APP, 'failure')].map((run) => ({ ...run, completed_at: second })),
    {
      conclusion: 'success',
      completed_at: second,
    },
  );
  expect(tie.status).toBe(0);
  expect(tie.outputs).toContain('skip=red-run');
  expect(tie.outputs).not.toContain('verified=true');
  // The Actions pass alone, or a pass a second after the failure, still reuses green.
  const alone = release(`{"appId": ${APP}}`, [], { conclusion: 'success', completed_at: second });
  expect(alone.outputs).toContain('verified=true');
  const later = release(`{"appId": ${APP}}`, [{ ...fromApp(APP, 'failure'), completed_at: second }], {
    conclusion: 'success',
    completed_at: '2026-11-21T09:00:01Z',
  });
  expect(later.outputs).toContain('verified=true');
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

test('a full run whose App Check ended while an Actions full-run job of the commit still runs counts as running', () => {
  const started = Date.parse('2026-11-21T08:00:00Z') / 1000;
  const browser: CheckRunFixture = {
    ...fromActions,
    name: 'Full run / Browser 1',
    conclusion: null,
    status: 'in_progress',
  };
  const decision = fullRunDecision(`{"appId": ${APP}}`, [fromApp(APP), browser]);
  expect(decision.status).toBe(0);
  expect(decision.rule).toBe(`scripts/ci/full-run.ts due --run ${'c0'.padEnd(40, '0')},${started},running`);
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
