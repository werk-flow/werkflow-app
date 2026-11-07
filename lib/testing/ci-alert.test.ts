import { afterEach, beforeEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '../..');
const alertScript = join(repositoryRoot, '.github/scripts/alert-issue.sh');
const candidateScript = join(repositoryRoot, '.github/scripts/release-candidate.sh');
const TITLE = 'CI alert: nightly';
const RUN_URL = 'https://github.test/owner/repo/actions/runs/7';

// Answers like gh: `--jq` runs through real jq, so the scripts' own filters are under test.
const GH_STUB = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB/gh.log"
filter=.
previous=
for argument in "$@"; do
  if test "$previous" = --jq; then filter="$argument"; fi
  previous="$argument"
done
case "$*" in
  'issue list'*) cat "$STUB/issues.json" ;;
  *'/jobs?'*) jq -r "$filter" "$STUB/jobs.json" ;;
  *'actions/runs?'*) jq -r "$filter" "$STUB/runs.json" ;;
esac
`;

let stub = '';

beforeEach(() => {
  stub = mkdtempSync(join(tmpdir(), 'ci-alert-'));
  writeFileSync(join(stub, 'gh'), GH_STUB);
  chmodSync(join(stub, 'gh'), 0o755);
  writeFileSync(join(stub, 'gh.log'), '');
  writeFileSync(join(stub, 'output'), '');
  writeOpenIssues([]);
  writeJobs([]);
});

afterEach(() => rmSync(stub, { recursive: true, force: true }));

function writeOpenIssues(issues: { number: number; title: string }[]) {
  writeFileSync(join(stub, 'issues.json'), JSON.stringify(issues));
}

function writeJobs(jobs: unknown[]) {
  writeFileSync(join(stub, 'jobs.json'), JSON.stringify({ jobs }));
}

function bash(cwd: string, script: string, args: string[], extraEnv: Record<string, string> = {}) {
  return spawnSync('bash', [script, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      NODE_ENV: 'test',
      PATH: `${stub}:${process.env.PATH}`,
      STUB: stub,
      GH_REPO: 'owner/repo',
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_SERVER_URL: 'https://github.test',
      GITHUB_RUN_ID: '7',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_OUTPUT: join(stub, 'output'),
      ...extraEnv,
    },
  });
}

/** The gh calls that write to an issue. */
function issueWrites(args: string[], extraEnv: Record<string, string> = {}) {
  const result = bash(repositoryRoot, alertScript, args, extraEnv);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return readFileSync(join(stub, 'gh.log'), 'utf8')
    .split(/\n(?=issue |api )/)
    .filter((call) => /^issue (create|edit|comment|close)/.test(call));
}

test('a red run opens one issue that names the failed job, its step and the run', () => {
  writeJobs([
    { name: 'Full run / Unit', conclusion: 'success', steps: [] },
    {
      name: 'Full run / Browser 6',
      conclusion: 'cancelled',
      steps: [
        { name: 'Start the test server', conclusion: 'success' },
        { name: 'Run browser groups', conclusion: 'cancelled' },
      ],
    },
    { name: 'Alert', conclusion: null, steps: [] },
  ]);
  const [create, ...rest] = issueWrites(['run', TITLE, 'failure success skipped']);
  expect(rest).toEqual([]);
  expect(create).toContain(`issue create --title ${TITLE}`);
  expect(create).toContain('--label ci-alert');
  expect(create).toContain('- Full run / Browser 6: Run browser groups');
  expect(create).toContain(`Run: ${RUN_URL}`);
  expect(create).not.toContain('Full run / Unit');
  expect(create).not.toContain('- Alert');
});

test('a second red run updates the open issue instead of opening another', () => {
  writeOpenIssues([{ number: 12, title: TITLE }]);
  const writes = issueWrites(['run', TITLE, 'failure']);
  expect(writes).toHaveLength(2);
  expect(writes[0]).toStartWith('issue edit 12 --body');
  expect(writes[1]).toBe(`issue comment 12 --body Still failing: ${RUN_URL}\n`);
});

test('a run that tested nothing leaves the open issue body to the last run that did', () => {
  writeOpenIssues([{ number: 12, title: TITLE }]);
  const writes = issueWrites(['keep', TITLE, 'No date ran.']);
  expect(writes).toHaveLength(1);
  expect(writes[0]).toStartWith('issue comment 12 --body No date ran.');
  expect(writes[0]).toContain(`Run: ${RUN_URL}`);
});

test('a run that tested nothing still opens an issue when none is open', () => {
  const [create, ...rest] = issueWrites(['keep', TITLE, 'No date ran.']);
  expect(rest).toEqual([]);
  expect(create).toContain(`issue create --title ${TITLE}`);
  expect(create).toContain('No date ran.');
});

test('a job a timeout cancelled counts as red', () => {
  expect(issueWrites(['run', TITLE, 'cancelled success'])[0]).toStartWith('issue create');
});

test('a green run closes the open issue of its own title only', () => {
  writeOpenIssues([
    { number: 12, title: 'CI alert: release' },
    { number: 13, title: `${TITLE} (proof)` },
    { number: 14, title: TITLE },
  ]);
  expect(issueWrites(['run', TITLE, 'success skipped'])).toEqual([
    `issue close 14 --comment Green again: ${RUN_URL}\n`,
  ]);
});

test('a green run closes a duplicate a race left behind', () => {
  writeOpenIssues([
    { number: 14, title: TITLE },
    { number: 15, title: TITLE },
  ]);
  expect(issueWrites(['run', TITLE, 'success'])).toEqual([
    `issue close 14 --comment Green again: ${RUN_URL}`,
    `issue close 15 --comment Green again: ${RUN_URL}\n`,
  ]);
});

// The production watcher closes its own alert and says why (.github/workflows/production-alert.yml).
test('a close with a note says why, with the run', () => {
  writeOpenIssues([{ number: 14, title: 'Production alert: deploy' }]);
  expect(issueWrites(['close', 'Production alert: deploy', 'Production serves its head again.'])).toEqual([
    `issue close 14 --comment Production serves its head again.\n\nRun: ${RUN_URL}\n`,
  ]);
});

test('the production alert workflow offers every title the production watcher raises', () => {
  const workflow = readFileSync(join(repositoryRoot, '.github/workflows/production-alert.yml'), 'utf8');
  for (const title of [
    'CI alert: release',
    'Production alert: deploy',
    'Production alert: server errors',
    'Production alert: watcher',
  ])
    expect(workflow).toContain(`- '${title}'\n`);
  expect(workflow).toContain('alert-issue.sh "$ACTION" "$TITLE" "$NOTE"');
  // A pending run replaces the older pending run of its group, so one alert cannot drop another's.
  expect(workflow).toContain('group: production-alert-${{ inputs.title }}\n');
});

test('a failed issue lookup fails the job instead of passing without a report', () => {
  rmSync(join(stub, 'issues.json'));
  for (const args of [
    ['close', TITLE],
    ['open', TITLE, 'body'],
  ])
    expect(bash(repositoryRoot, alertScript, args).status, args[0]).not.toBe(0);
});

test('a green run with no open issue writes nothing', () => {
  expect(issueWrites(['run', TITLE, 'success success'])).toEqual([]);
});

test('a release stopped by a red full run is reported though every job passed', () => {
  const reason = 'The newest full run on main (abc) ended failure: https://github.test/run';
  const [create] = issueWrites([
    'run',
    'CI alert: release',
    'success skipped skipped skipped',
    'red-run',
    reason,
  ]);
  expect(create).toContain('issue create --title CI alert: release');
  expect(create).toContain(`The scheduled release did not ship. ${reason}`);
});

test('a release with nothing to ship neither reports nor closes an open issue', () => {
  writeOpenIssues([{ number: 12, title: 'CI alert: release' }]);
  const skip = ['no-change', 'main equals production'];
  expect(issueWrites(['run', 'CI alert: release', 'success skipped skipped skipped', ...skip])).toEqual([]);
});

const PRODUCTION = { AFFECTS_PRODUCTION: 'true' };

test('an alert that does not affect production opens without an assignee', () => {
  for (const args of [
    ['run', TITLE, 'failure'],
    ['keep', TITLE, 'No date ran.'],
  ]) {
    writeFileSync(join(stub, 'gh.log'), '');
    const [create, ...rest] = issueWrites(args);
    expect(rest, args[0]).toEqual([]);
    expect(create, args[0]).toStartWith('issue create');
    expect(create, args[0]).not.toContain('assignee');
  }
});

test('a production failure opens its alert with the owner assigned', () => {
  const [create, ...rest] = issueWrites(['run', 'CI alert: release', 'failure'], PRODUCTION);
  expect(rest).toEqual([]);
  expect(create).toStartWith('issue create --title CI alert: release');
  expect(create).toContain('--assignee tamaycbn');
});

test('an open alert that turns into a production failure gains the owner', () => {
  writeOpenIssues([{ number: 12, title: TITLE }]);
  const opened = issueWrites(['open', TITLE, 'A prod check failed.'], PRODUCTION);
  expect(opened.at(-1)).toBe('issue edit 12 --add-assignee tamaycbn\n');
  writeFileSync(join(stub, 'gh.log'), '');
  const kept = issueWrites(['keep', TITLE, 'No date ran.'], PRODUCTION);
  expect(kept.at(-1)).toBe('issue edit 12 --add-assignee tamaycbn\n');
});

test('an update that does not affect production changes no assignee', () => {
  writeOpenIssues([{ number: 12, title: TITLE }]);
  for (const args of [
    ['open', TITLE, 'A dev check failed.'],
    ['keep', TITLE, 'No date ran.'],
  ])
    for (const write of issueWrites(args)) expect(write, args[0]).not.toContain('assignee');
});

test('an unreadable production flag fails the job instead of guessing', () => {
  const result = bash(repositoryRoot, alertScript, ['run', TITLE, 'failure'], { AFFECTS_PRODUCTION: 'yes' });
  expect(result.status).not.toBe(0);
  expect(readFileSync(join(stub, 'gh.log'), 'utf8')).toBe('');
});

test('only the release, its missed-run alert and the health check can assign the owner', () => {
  const workflows = join(repositoryRoot, '.github/workflows');
  const callers = readdirSync(workflows).filter((file) =>
    readFileSync(join(workflows, file), 'utf8').includes('AFFECTS_PRODUCTION'),
  );
  expect(callers.sort()).toEqual(['health.yml', 'production-alert.yml', 'release.yml']);
  for (const file of ['release.yml', 'production-alert.yml'])
    expect(readFileSync(join(workflows, file), 'utf8'), file).toContain('AFFECTS_PRODUCTION: true\n');
});

test('every caller of the health check names its environment first', () => {
  const callers = [
    ...readdirSync(join(repositoryRoot, '.github/workflows')).map((file) => `.github/workflows/${file}`),
    ...readdirSync(join(repositoryRoot, '.github/scripts')).map((file) => `.github/scripts/${file}`),
  ];
  const calls = callers.flatMap((file) =>
    [
      ...readFileSync(join(repositoryRoot, file), 'utf8').matchAll(
        /(?:\$CHECK|bash \.github\/scripts\/health-check\.sh) (\S+)/g,
      ),
    ].map((call) => ({ file, environment: call[1] ?? '' })),
  );
  expect(calls.filter((call) => call.file === '.github/workflows/health.yml').length).toBeGreaterThan(0);
  expect(calls.filter((call) => call.file === '.github/scripts/release-smoke.sh')).toEqual([
    { file: '.github/scripts/release-smoke.sh', environment: 'prod' },
  ]);
  for (const call of calls) expect(call.environment, call.file).toMatch(/^(dev|prod)$/);
});

test('a health check step reports its environment even when it fails', () => {
  const healthScript = join(repositoryRoot, '.github/scripts/health-check.sh');
  const missing = bash(repositoryRoot, healthScript, [
    'prod',
    'app-production',
    'endpoint',
    'UNSET_TOKEN',
    'x',
  ]);
  expect(missing.status).not.toBe(0);
  expect(readFileSync(join(stub, 'output'), 'utf8')).toBe('environment=prod\n');
  writeFileSync(join(stub, 'output'), '');
  const unknown = bash(repositoryRoot, healthScript, [
    'staging',
    'app-staging',
    'endpoint',
    'UNSET_TOKEN',
    'x',
  ]);
  expect(unknown.status).not.toBe(0);
  expect(readFileSync(join(stub, 'output'), 'utf8')).toBe('');
});

function commit(cwd: string, message: string) {
  const git = spawnSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '--allow-empty', '-qm', message],
    { cwd, encoding: 'utf8' },
  );
  expect(git.status).toBe(0);
}

function revParse(cwd: string, ref: string) {
  return spawnSync('git', ['rev-parse', ref], { cwd, encoding: 'utf8' }).stdout.trim();
}

/** Runs the release decision on a repository whose main is `ahead` of production. */
function decide(mode: string, ahead: boolean, fullRunConclusion: string) {
  const repository = join(stub, 'repository');
  expect(spawnSync('git', ['init', '-qb', 'main', repository]).status).toBe(0);
  commit(repository, 'shipped');
  spawnSync('git', ['update-ref', 'refs/remotes/origin/production', 'HEAD'], { cwd: repository });
  if (ahead) commit(repository, 'new');
  writeFileSync(
    join(stub, 'runs.json'),
    JSON.stringify({
      workflow_runs: [
        { id: 3, head_branch: 'main', path: '.github/workflows/nightly.yml', event: 'schedule' },
      ],
    }),
  );
  writeJobs([
    {
      name: 'Full run / Check',
      status: 'completed',
      completed_at: '2026-11-06T09:00:00Z',
      conclusion: fullRunConclusion,
      html_url: 'https://github.test/job',
    },
  ]);
  const result = bash(repository, candidateScript, [mode]);
  expect(result.status).toBe(0);
  return {
    sha: revParse(repository, 'HEAD'),
    outputs: readFileSync(join(stub, 'output'), 'utf8').trim().split('\n'),
  };
}

test('a scheduled release at a red full run stays green and names the skip for the alert', () => {
  const { sha, outputs } = decide('scheduled', true, 'failure');
  expect(outputs).toEqual([
    `sha=${sha}`,
    'release=false',
    'skip=red-run',
    `skip_reason=The newest full run on main (${sha}) ended failure: https://github.test/job`,
  ]);
});

test('a scheduled release with main equal to production skips quietly', () => {
  const { sha, outputs } = decide('scheduled', false, 'success');
  expect(outputs).toEqual([
    `sha=${sha}`,
    'release=false',
    'skip=no-change',
    `skip_reason=main (${sha}) equals production; nothing to release.`,
  ]);
});

test('a dry run stops where a scheduled run stops and marks nothing to ship', () => {
  const stopsOf = (mode: string, ahead: boolean, conclusion: string) => {
    writeFileSync(join(stub, 'output'), '');
    rmSync(join(stub, 'repository'), { recursive: true, force: true });
    const { sha, outputs } = decide(mode, ahead, conclusion);
    return outputs.map((line) => line.replaceAll(sha, '<sha>'));
  };
  const redRun = stopsOf('dry-run', true, 'failure');
  expect(redRun).toEqual(stopsOf('scheduled', true, 'failure'));
  expect(redRun).toContain('release=false');
  expect(redRun).toContain('skip=red-run');
  const noChange = stopsOf('dry-run', false, 'success');
  expect(noChange).toEqual(stopsOf('scheduled', false, 'success'));
  expect(noChange).toContain('release=false');
  expect(noChange).toContain('skip=no-change');
});

test('the skip output changes no decision: a green or manual release still goes on', () => {
  expect(decide('scheduled', true, 'success').outputs).toContain('release=true');
  writeFileSync(join(stub, 'output'), '');
  rmSync(join(stub, 'repository'), { recursive: true, force: true });
  const manual = decide('manual', true, 'failure').outputs;
  expect(manual).toContain('release=true');
  expect(manual).toContain('verified=false');
  expect(manual.join('\n')).not.toContain('skip');
});
