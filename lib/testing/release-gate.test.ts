// Rule test: the release gate (.github/scripts/release-candidate.sh) reads GitHub without a token
// and trusts only the CI App's or GitHub Actions' `Full run / Check` on exactly the released commit.
// The newest one decides, and a read that fails, is rate-limited or is malformed stops the release.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { GITHUB_CURL_STUB } from './github-api-stub';

const repositoryRoot = resolve(import.meta.dir, '../..');
const APP = 4242;
const TOKEN = 'github-token-that-must-stay-off-argv';
const T = '2026-11-21T09:00:00Z';

let stub = '';
let commit = '';

beforeEach(() => {
  stub = mkdtempSync(join(tmpdir(), 'release-gate-'));
  // The gate and its helpers beside a configuration naming APP: check-app.sh reads the file next to itself.
  mkdirSync(join(stub, 'scripts'));
  for (const name of ['check-app.sh', 'curl-headers.sh', 'full-run-verdict.sh', 'release-candidate.sh'])
    copyFileSync(join(repositoryRoot, '.github/scripts', name), join(stub, 'scripts', name));
  writeFileSync(join(stub, 'scripts', 'check-app.json'), `{"appId": ${APP}}`);
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

type Run = {
  conclusion: string | null;
  completed_at: string | null;
  app?: number;
  head_sha?: string;
} & Record<string, unknown>;

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

type Job = Omit<Run, 'app'> & { status?: string };

/** A nightly run on GitHub Actions on `head_sha` whose `Full run / Check` jobs, one per attempt, ended as given. */
function actionsChecks(jobs: readonly Job[], head_sha = jobs[0]?.head_sha ?? '@commit') {
  const nightly = {
    id: 1,
    head_sha,
    head_branch: 'main',
    path: '.github/workflows/nightly.yml',
    event: 'schedule',
  };
  writeFileSync(join(stub, 'runs.json'), JSON.stringify({ workflow_runs: [nightly] }));
  writeFileSync(
    join(stub, 'jobs.json'),
    JSON.stringify({
      jobs: jobs.map((job, attempt) => ({
        name: 'Full run / Check',
        status: 'completed',
        head_sha,
        html_url: `https://github.test/attempt/${attempt + 1}`,
        ...job,
      })),
    }),
  );
}

function decide(mode = 'scheduled', env: Record<string, string> = {}) {
  writeFileSync(join(stub, 'output'), '');
  rmSync(join(stub, 'curl.log'), { force: true });
  const result = spawnSync('bash', [join(stub, 'scripts', 'release-candidate.sh'), mode], {
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

/** A gate that stopped before any decision: only the commit is written. */
function expectStopped(result: ReturnType<typeof decide>, reason: string, label = reason) {
  expect(result.status, label).not.toBe(0);
  expect(result.output, label).toContain(reason);
  expect(result.outputs, label).toEqual([`sha=${commit}`]);
}

test('a green full run of the CI App on the commit releases, read without a token or gh', () => {
  appChecks([{ conclusion: 'success', completed_at: T }]);
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
  appChecks([{ conclusion: 'success', completed_at: T, app: 999 }]);
  const result = decide();
  expect(result.status, result.output).toBe(0);
  expect(result.outputs).toContain('verified=false');
});

test("another commit's full run is refused, from the CI App and from GitHub Actions", () => {
  const other = 'f'.repeat(40);
  appChecks([{ conclusion: 'success', completed_at: T, head_sha: other }]);
  expect(decide().outputs).toContain('verified=false');
  rmSync(join(stub, 'check-runs.json'));
  actionsChecks([{ conclusion: 'success', completed_at: T, head_sha: other }]);
  expect(decide().outputs).toContain('verified=false');
  // A job of another commit inside a run listed for this one counts for nothing either.
  actionsChecks([{ conclusion: 'success', completed_at: T, head_sha: other }], '@commit');
  expect(decide().outputs).toContain('verified=false');
});

test('a later failure replaces a pass, across sources and on a page the Link header names', () => {
  // A short first page that names a next one: the failure is on page 2.
  appChecks([{ conclusion: 'success', completed_at: '2026-11-21T08:00:00Z' }]);
  appChecks([{ conclusion: 'failure', completed_at: '2026-11-21T10:00:00Z' }], 'check-runs.2.json');
  actionsChecks([{ conclusion: 'success', completed_at: T }]);
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

test('a failed attempt counts while its rerun still runs', () => {
  appChecks([{ conclusion: 'success', completed_at: '2026-11-21T08:00:00Z' }]);
  actionsChecks([
    { conclusion: 'failure', completed_at: T },
    { conclusion: '', completed_at: null, status: 'in_progress' },
  ]);
  const result = decide();
  expect(result.urls.some((url) => url.includes('/jobs?filter=all&'))).toBe(true);
  expect(result.outputs).toContain('skip=red-run');
});

test('a non-success that ends in the same second as a pass wins the tie, whatever its name sorts as', () => {
  for (const conclusion of ['failure', 'timed_out', 'stale']) {
    appChecks([{ conclusion, completed_at: T }]);
    actionsChecks([{ conclusion: 'success', completed_at: T }]);
    const result = decide();
    expect(result.outputs, conclusion).toContain('skip=red-run');
    expect(result.outputs, conclusion).not.toContain('verified=true');
  }
});

test('a rate-limited, refused or failed read fails the gate closed in every mode', () => {
  appChecks([{ conclusion: 'success', completed_at: T }]);
  const answers = [
    { status: '403', headers: 'x-ratelimit-remaining: 0\r\n', reason: "GitHub's rate limit refused" },
    { status: '429', headers: '', reason: "GitHub's rate limit refused" },
    { status: '502', headers: '', reason: 'GitHub did not answer' },
    { status: '404', headers: '', reason: 'GitHub did not answer' },
  ];
  for (const { status, headers, reason } of answers) {
    writeFileSync(join(stub, 'github-status'), status);
    writeFileSync(join(stub, 'github-headers'), headers);
    for (const mode of ['scheduled', 'manual', 'dry-run'])
      expectStopped(decide(mode), reason, `${status} ${mode}`);
  }
});

test('an answer that is not one list fails the gate closed', () => {
  for (const body of ['{"message": "Not Found"}', `{"check_runs": []} {"check_runs": []}`, '']) {
    writeFileSync(join(stub, 'check-runs.json'), body);
    expectStopped(decide(), 'is not one check_runs list', body);
  }
});

test('a decoder that fails after part of a page fails the gate closed', () => {
  appChecks([{ conclusion: 'success', completed_at: T }]);
  const jq = Bun.which('jq') ?? 'jq';
  // Emits the page, then fails, as a decoder cut off mid-answer would.
  writeFileSync(
    join(stub, 'jq'),
    `#!/usr/bin/env bash\nif [[ " $* " == *" --slurp "* ]]; then ${jq} "$@"; exit 1; fi\nexec ${jq} "$@"\n`,
  );
  chmodSync(join(stub, 'jq'), 0o755);
  expectStopped(decide(), 'is not one');
});

test('a check without a status, a real end time, a conclusion or a URL stops the gate instead of sorting', () => {
  const failure = { conclusion: 'failure', completed_at: T };
  const malformed: Partial<Run>[] = [
    { completed_at: null },
    { completed_at: '2026-02-31T09:00:00Z' },
    { completed_at: '2026-11-21T09:00:00+01:00' },
    { conclusion: null },
    { conclusion: 'success now' },
    { conclusion: 'success\n' },
    { details_url: 'https://ci.test/run/1\n' },
    { status: 'complete' },
    { details_url: null, html_url: null },
    { status: null },
    { status: undefined },
  ];
  for (const fields of malformed) {
    appChecks([failure, { conclusion: 'success', completed_at: '2026-11-21T10:00:00Z', ...fields }]);
    expectStopped(decide(), 'without a valid status, end time, conclusion or URL', JSON.stringify(fields));
  }
  rmSync(join(stub, 'check-runs.json'));
  actionsChecks([failure, { conclusion: 'success', completed_at: '2026-02-30T10:00:00Z' }]);
  expectStopped(decide(), 'GitHub lists a full-run job');
});

test('the gate reads only api.github.com and this repository, whatever the environment names', () => {
  appChecks([{ conclusion: 'success', completed_at: T }]);
  const result = decide('scheduled', {
    GH_TOKEN: TOKEN,
    GITHUB_API_URL: 'https://api.elsewhere.test',
    GITHUB_REPOSITORY: 'someone/else',
  });
  expect(result.outputs).toContain('verified=true');
  expect(result.urls.length).toBeGreaterThan(0);
  for (const url of result.urls)
    expect(url).toStartWith('https://api.github.com/repos/werk-flow/werkflow-app/');
});

test('a GH_TOKEN, where set, reaches only api.github.com, and only as a curl config, never as an argument', () => {
  writeFileSync(
    join(stub, 'curl'),
    GITHUB_CURL_STUB.replace('url="', 'echo "$*" >> "$STUB/arguments"\nurl="'),
  );
  appChecks([{ conclusion: 'success', completed_at: T }]);
  actionsChecks([{ conclusion: 'success', completed_at: T }]);
  const result = decide('scheduled', { GH_TOKEN: TOKEN });
  expect(result.outputs).toContain('verified=true');
  expect(result.config).toContain(`header = "Authorization: Bearer ${TOKEN}"`);
  expect(result.urls.length).toBeGreaterThan(0);
  for (const url of result.urls) expect(url).toStartWith('https://api.github.com/');
  expect(readFileSync(join(stub, 'arguments'), 'utf8')).not.toContain(TOKEN);
  expect(result.output).not.toContain(TOKEN);
});
