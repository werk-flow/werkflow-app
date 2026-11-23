// Rule test: a scheduled nightly skips main's head only when the release gate's reader
// (.github/scripts/full-run-verdict.sh) finds its newest full run green: a nightly, release or
// main-full-run run of exactly that commit on main, or the CI App's check run, the newest across
// both, a failure winning a tie. A night that skipped closes no alert. The steps run as
// nightly.yml writes them, against a stubbed GitHub API.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readWorkflow } from './ci-workflow';
import { GITHUB_CURL_STUB } from './github-api-stub';
import { temporaryDirectory } from './temporary-directory';

const repositoryRoot = resolve(import.meta.dir, '../..');
const APP = 4242;
const COMMIT = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const EARLY = '2026-11-23T09:00:00Z';
const LATE = '2026-11-23T10:00:00Z';
const nightly = readWorkflow('nightly.yml');

let stub = '';

beforeEach(() => {
  stub = temporaryDirectory('nightly-skip-');
  const scripts = join(stub, 'checkout/.github/scripts');
  mkdirSync(scripts, { recursive: true });
  for (const name of ['check-app.sh', 'curl-headers.sh', 'full-run-verdict.sh'])
    copyFileSync(join(repositoryRoot, '.github/scripts', name), join(scripts, name));
  writeFileSync(join(scripts, 'check-app.json'), `{"appId": ${APP}}`);
  writeFileSync(join(stub, 'curl'), GITHUB_CURL_STUB);
  writeFileSync(join(stub, 'gh'), '#!/usr/bin/env bash\nexit 1\n');
  for (const name of ['curl', 'gh']) chmodSync(join(stub, name), 0o755);
});

afterEach(() => rmSync(stub, { recursive: true, force: true }));

type ActionsRun = { path: string; event?: string; head_branch?: string; head_sha?: string; job_sha?: string };

/** One Actions run of `run.path` whose `Full run / Check` ended as given at `completed_at`. */
function actionsRun(run: ActionsRun, conclusion: string, completed_at: string) {
  const head_sha = run.head_sha ?? '@commit';
  writeFileSync(
    join(stub, 'runs.json'),
    JSON.stringify({
      workflow_runs: [
        {
          id: 1,
          head_sha,
          head_branch: run.head_branch ?? 'main',
          event: run.event ?? 'schedule',
          path: run.path,
        },
      ],
    }),
  );
  writeFileSync(
    join(stub, 'jobs.json'),
    JSON.stringify({
      jobs: [
        {
          name: 'Full run / Check',
          status: 'completed',
          head_sha: run.job_sha ?? head_sha,
          conclusion,
          completed_at,
          html_url: 'https://github.test/1',
        },
      ],
    }),
  );
}

/** The CI App's `Full run / Check` on the commit. */
function appCheck(conclusion: string, completed_at: string) {
  writeFileSync(
    join(stub, 'check-runs.json'),
    JSON.stringify({
      check_runs: [
        {
          name: 'Full run / Check',
          status: 'completed',
          head_sha: '@commit',
          app: { id: APP },
          conclusion,
          completed_at,
          details_url: 'https://ci.test/1',
        },
      ],
    }),
  );
}

/** The decide step's answer: its success and its head_has_full_run output. */
function decide() {
  writeFileSync(join(stub, 'output'), '');
  const result = nightly.runStep('decide', 'Decide whether the head has a full run', {
    cwd: join(stub, 'checkout'),
    env: {
      PATH: `${stub}:${process.env.PATH}`,
      STUB: stub,
      COMMIT,
      GITHUB_SHA: COMMIT,
      GITHUB_REF: 'refs/heads/main',
      GITHUB_OUTPUT: join(stub, 'output'),
    },
  });
  return { passed: result.passed, output: readFileSync(join(stub, 'output'), 'utf8').trim() };
}

test('only a green full run of an approved workflow on main at exactly the head lets the nightly skip', () => {
  actionsRun({ path: '.github/workflows/nightly.yml' }, 'success', EARLY);
  expect(decide()).toEqual({ passed: true, output: 'head_has_full_run=true' });
  for (const run of [
    { path: '.github/workflows/main-full-run.yml', event: 'workflow_dispatch' },
    { path: '.github/workflows/release.yml' },
  ]) {
    actionsRun(run, 'success', EARLY);
    expect(decide(), run.path).toEqual({ passed: true, output: 'head_has_full_run=true' });
  }
  for (const run of [
    { path: '.github/workflows/ci.yml', event: 'pull_request' },
    { path: '.github/workflows/nightly.yml', head_branch: 'feature' },
    { path: '.github/workflows/nightly.yml', head_sha: OTHER },
    { path: '.github/workflows/nightly.yml', event: 'push' },
    { path: '.github/workflows/ci.yml', event: 'workflow_dispatch' },
    { path: '.github/workflows/date-lookahead.yml' },
    { path: '.github/workflows/nightly.yml', job_sha: OTHER },
  ]) {
    actionsRun(run, 'success', EARLY);
    expect(decide(), JSON.stringify(run)).toEqual({ passed: true, output: 'head_has_full_run=false' });
  }
});

test('the newest full run across Actions and the CI App decides, and a failure wins a tie', () => {
  actionsRun({ path: '.github/workflows/nightly.yml' }, 'success', LATE);
  appCheck('failure', EARLY);
  expect(decide().output).toBe('head_has_full_run=true');
  actionsRun({ path: '.github/workflows/nightly.yml' }, 'success', EARLY);
  appCheck('failure', LATE);
  expect(decide().output).toBe('head_has_full_run=false');
  appCheck('failure', EARLY);
  expect(decide().output).toBe('head_has_full_run=false');
  rmSync(join(stub, 'runs.json'));
  appCheck('success', LATE);
  expect(decide().output).toBe('head_has_full_run=true');
});

test('a failed read fails the decision, so the full run starts', () => {
  actionsRun({ path: '.github/workflows/nightly.yml' }, 'success', EARLY);
  writeFileSync(join(stub, 'github-status'), '502');
  expect(decide()).toEqual({ passed: false, output: '' });
});

/** Whether the alert step called alert-issue.sh, and with what. */
function alert(skipped: boolean, results: string) {
  const scripts = join(stub, 'alert/.github/scripts');
  mkdirSync(scripts, { recursive: true });
  rmSync(join(stub, 'alert-call'), { force: true });
  writeFileSync(join(scripts, 'alert-issue.sh'), 'printf "%s\\n" "$*" > "$STUB/alert-call"\n');
  const result = nightly.runStep('alert', 'Open, update or close the alert issue', {
    cwd: join(stub, 'alert'),
    env: { STUB: stub, TITLE: 'CI alert: nightly', RESULTS: results, SKIPPED_FULL_RUN: String(skipped) },
  });
  expect(result.passed).toBe(true);
  const call = join(stub, 'alert-call');
  return existsSync(call) ? readFileSync(call, 'utf8').trim() : undefined;
}

test('a night that skipped the full run closes no alert, but its failed quarantine job still opens one', () => {
  // needs: decide, full, quarantine, proof
  expect(alert(true, 'success skipped success skipped')).toBeUndefined();
  expect(alert(true, 'success skipped failure skipped')).toBe(
    'run CI alert: nightly success skipped failure skipped',
  );
  expect(alert(false, 'success success success skipped')).toBe(
    'run CI alert: nightly success success success skipped',
  );
  // The alert job itself runs on a skipped night, so the quarantine failure reaches it.
  expect(nightly.text('jobs', 'alert', 'if')).toBe(
    "${{ !cancelled() && (github.ref == 'refs/heads/main' || inputs.alert_proof) }}",
  );
  expect(nightly.text('jobs', 'alert', 'steps', 1, 'env', 'SKIPPED_FULL_RUN')).toBe(
    "${{ needs.decide.result == 'success' && needs.decide.outputs.head_has_full_run == 'true' }}",
  );
});
