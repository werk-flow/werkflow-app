// Rule test: the release gate (.github/scripts/release-candidate.sh) reads GitHub without a token
// and trusts only the CI App's or GitHub Actions' `Full run / Check` on exactly the released commit.
// The newest one decides, and a read that fails or is rate-limited stops the release.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readCheckApp } from './ci/check-app';
import { GITHUB_CURL_STUB } from './github-api-stub';

const repositoryRoot = resolve(import.meta.dir, '../..');
const candidateScript = join(repositoryRoot, '.github/scripts/release-candidate.sh');
const committed = readCheckApp(join(repositoryRoot, '.github/scripts/check-app.json'));
const APP = 'appId' in committed ? committed.appId : null;
const TOKEN = 'github-token-that-must-stay-off-argv';

let stub = '';
let commit = '';

beforeEach(() => {
  stub = mkdtempSync(join(tmpdir(), 'release-gate-'));
  writeFileSync(join(stub, 'curl'), GITHUB_CURL_STUB);
  // The gate needs no gh, so a machine without one or without its token decides too.
  writeFileSync(join(stub, 'gh'), '#!/usr/bin/env bash\necho "gh $*" >> "$STUB/gh.log"\nexit 1\n');
  for (const name of ['curl', 'gh']) chmodSync(join(stub, name), 0o755);
  const repository = join(stub, 'repository');
  const git = (...args: string[]) =>
    spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', ...args], {
      cwd: repository,
      encoding: 'utf8',
    });
  spawnSync('git', ['init', '-qb', 'main', repository]);
  git('commit', '--allow-empty', '-qm', 'shipped');
  git('update-ref', 'refs/remotes/origin/production', 'HEAD');
  git('commit', '--allow-empty', '-qm', 'new');
  commit = git('rev-parse', 'HEAD').stdout.trim();
});

afterEach(() => rmSync(stub, { recursive: true, force: true }));

type Run = { conclusion: string; completed_at: string; app?: number; head_sha?: string };

/** The CI App's `Full run / Check` runs on the commit, as GitHub lists them. */
function appChecks(runs: readonly Run[], file = 'check-runs.json') {
  writeFileSync(
    join(stub, file),
    JSON.stringify({
      check_runs: runs.map(({ app = APP, ...run }, index) => ({
        name: 'Full run / Check',
        status: 'completed',
        head_sha: '@commit',
        app: { id: app },
        details_url: `https://ci.test/run/${index}`,
        ...run,
      })),
    }),
  );
}

/** A nightly run on GitHub Actions whose `Full run / Check` job ended as given. */
function actionsCheck(run: Run) {
  const { head_sha = '@commit', ...job } = run;
  writeFileSync(
    join(stub, 'runs.json'),
    JSON.stringify({
      workflow_runs: [
        { id: 1, head_sha, head_branch: 'main', path: '.github/workflows/nightly.yml', event: 'schedule' },
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
          head_sha,
          html_url: 'https://github.test/1',
          ...job,
        },
      ],
    }),
  );
}

function decide(mode = 'scheduled', env: Record<string, string> = {}) {
  writeFileSync(join(stub, 'output'), '');
  const result = spawnSync('bash', [candidateScript, mode], {
    cwd: join(stub, 'repository'),
    encoding: 'utf8',
    env: {
      NODE_ENV: 'test',
      PATH: `${stub}:${process.env.PATH}`,
      STUB: stub,
      COMMIT: commit,
      GITHUB_REF: 'refs/heads/main',
      GITHUB_OUTPUT: join(stub, 'output'),
      ...env,
    },
  });
  const read = (name: string) => (existsSync(join(stub, name)) ? readFileSync(join(stub, name), 'utf8') : '');
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    outputs: read('output').trim().split('\n').filter(Boolean),
    urls: read('curl.log').trim().split('\n').filter(Boolean),
    config: read('curl-config'),
    gh: read('gh.log'),
  };
}

test('the committed configuration names the CI App the gate trusts', () => {
  expect(APP).not.toBeNull();
});

test('a green full run of the CI App on the commit releases, read without a token or gh', () => {
  appChecks([{ conclusion: 'success', completed_at: '2026-11-21T09:00:00Z' }]);
  const result = decide();
  expect(result.status, result.output).toBe(0);
  expect(result.outputs).toContain('verified=true');
  expect(result.outputs).toContain('release=true');
  expect(result.urls).toContain(
    `https://api.github.com/repos/werk-flow/werkflow-app/commits/${commit}/check-runs?check_name=Full%20run%20%2F%20Check&filter=all&app_id=${APP}&per_page=100&page=1`,
  );
  expect(result.config).toBe('');
  expect(result.gh).toBe('');
});

test("another App's check run of the same name is refused", () => {
  appChecks([{ conclusion: 'success', completed_at: '2026-11-21T09:00:00Z', app: 999 }]);
  const result = decide();
  expect(result.status, result.output).toBe(0);
  expect(result.outputs).toContain('verified=false');
});

test("another commit's full run is refused, from the CI App and from GitHub Actions", () => {
  const other = 'f'.repeat(40);
  appChecks([{ conclusion: 'success', completed_at: '2026-11-21T09:00:00Z', head_sha: other }]);
  expect(decide().outputs).toContain('verified=false');
  rmSync(join(stub, 'check-runs.json'));
  actionsCheck({ conclusion: 'success', completed_at: '2026-11-21T09:00:00Z', head_sha: other });
  expect(decide().outputs).toContain('verified=false');
});

test('a later failure replaces a pass, across sources and pages', () => {
  // 100 older passes fill the first page; the failure is on the second.
  appChecks(
    Array.from({ length: 100 }, () => ({ conclusion: 'success', completed_at: '2026-11-21T08:00:00Z' })),
  );
  appChecks([{ conclusion: 'failure', completed_at: '2026-11-21T10:00:00Z' }], 'check-runs.2.json');
  actionsCheck({ conclusion: 'success', completed_at: '2026-11-21T09:00:00Z' });
  const result = decide();
  expect(result.status, result.output).toBe(0);
  expect(result.urls.some((url) => url.includes('/check-runs?') && url.endsWith('&page=2'))).toBe(true);
  expect(result.outputs).toContain('skip=red-run');
  expect(result.outputs).not.toContain('verified=true');
  // A manual run still goes on, with its own full run first.
  const manual = decide('manual');
  expect(manual.outputs).toContain('verified=false');
  expect(manual.outputs).toContain('release=true');
});

test('a rate-limited, refused or failed read fails the gate closed in every mode', () => {
  appChecks([{ conclusion: 'success', completed_at: '2026-11-21T09:00:00Z' }]);
  const answers = [
    { status: '403', headers: 'x-ratelimit-remaining: 0\r\n', reason: "GitHub's rate limit refused" },
    { status: '429', headers: '', reason: "GitHub's rate limit refused" },
    { status: '502', headers: '', reason: 'GitHub did not answer' },
    { status: '404', headers: '', reason: 'GitHub did not answer' },
  ];
  for (const { status, headers, reason } of answers) {
    writeFileSync(join(stub, 'github-status'), status);
    writeFileSync(join(stub, 'github-headers'), headers);
    for (const mode of ['scheduled', 'manual', 'dry-run']) {
      const result = decide(mode);
      expect(result.status, `${status} ${mode}`).not.toBe(0);
      expect(result.output, `${status} ${mode}`).toContain(reason);
      expect(result.outputs, `${status} ${mode}`).toEqual([`sha=${commit}`]);
    }
  }
  // A 200 that does not hold the list fails as well.
  rmSync(join(stub, 'github-status'));
  writeFileSync(join(stub, 'check-runs.json'), '{"message": "Not Found"}');
  const empty = decide();
  expect(empty.status).not.toBe(0);
  expect(empty.output).toContain('holds no check_runs list');
});

test('a GH_TOKEN, where set, reaches curl only as a config and never as an argument', () => {
  writeFileSync(
    join(stub, 'curl'),
    GITHUB_CURL_STUB.replace('url="', 'echo "$*" >> "$STUB/arguments"\nurl="'),
  );
  appChecks([{ conclusion: 'success', completed_at: '2026-11-21T09:00:00Z' }]);
  const result = decide('scheduled', { GH_TOKEN: TOKEN });
  expect(result.outputs).toContain('verified=true');
  expect(result.config).toContain(`header = "Authorization: Bearer ${TOKEN}"`);
  expect(readFileSync(join(stub, 'arguments'), 'utf8')).not.toContain(TOKEN);
  expect(result.output).not.toContain(TOKEN);
});
