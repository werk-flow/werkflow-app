import { afterEach, beforeEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function bash(cwd: string, script: string, args: string[]) {
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
    },
  });
}

/** The gh calls that write to an issue. */
function issueWrites(args: string[]) {
  const result = bash(repositoryRoot, alertScript, args);
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

test('the skip output changes no decision: a green or manual release still goes on', () => {
  expect(decide('scheduled', true, 'success').outputs).toContain('release=true');
  writeFileSync(join(stub, 'output'), '');
  rmSync(join(stub, 'repository'), { recursive: true, force: true });
  const manual = decide('manual', true, 'failure').outputs;
  expect(manual).toContain('release=true');
  expect(manual).toContain('verified=false');
  expect(manual.join('\n')).not.toContain('skip');
});
