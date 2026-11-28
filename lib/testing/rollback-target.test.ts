// Rule test: a rollback goes back only to a build that served production, of a released commit that
// no later destructive migration outran (.github/scripts/rollback-target.sh). Without a target it
// picks the release before the served one, so a second rollback steps back once more; a named
// target that serves already resumes.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve(import.meta.dir, '../../.github/scripts/rollback-target.sh');

// Answers like Vercel by URL: the production list is $STUB/list.json, the alias serves $STUB/served.
const CURL_STUB = `#!/usr/bin/env bash
output=
previous=
for argument in "$@"; do
  if test "$previous" = --output; then output="$argument"; fi
  previous="$argument"
done
url="\${!#}"
answer() { echo "$1" > "$output"; printf 200; }
case "$url" in
  *'/v6/deployments?'*) answer "$(cat "$STUB/list.json")" ;;
  *'/v4/aliases/'*) answer "{\\"deploymentId\\": \\"$(cat "$STUB/served")\\"}" ;;
  *) printf 000; exit 7 ;;
esac
`;

let stub = '';
let repo = '';
const commits: string[] = [];

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

beforeEach(() => {
  stub = mkdtempSync(join(tmpdir(), 'rollback-target-'));
  writeFileSync(join(stub, 'curl'), CURL_STUB);
  chmodSync(join(stub, 'curl'), 0o755);
  // Four commits; production holds the first three, the fourth is on main only.
  repo = mkdtempSync(join(tmpdir(), 'rollback-repo-'));
  git('init', '--quiet');
  commits.length = 0;
  for (const name of ['one', 'two', 'three', 'four']) {
    git(
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@example.test',
      'commit',
      '--quiet',
      '--allow-empty',
      '-m',
      name,
    );
    commits.push(git('rev-parse', 'HEAD'));
  }
  git('update-ref', 'refs/remotes/origin/production', commits[2] ?? '');
});

afterEach(() => {
  rmSync(stub, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

const commit = (index: number) => commits[index] ?? '';

/** Production builds, newest first, as Vercel lists them, and the one the domain serves. */
function builds(served: string, list: { uid: string; commit: number; created: number; served?: boolean }[]) {
  writeFileSync(join(stub, 'served'), served);
  const deployments = list.map((build) => ({
    uid: build.uid,
    created: build.created,
    isRollbackCandidate: build.served ?? true,
    meta: { githubCommitSha: commit(build.commit) },
  }));
  writeFileSync(join(stub, 'list.json'), JSON.stringify({ deployments }));
}

function plan(target = '') {
  const outputFile = join(stub, 'output');
  writeFileSync(outputFile, '');
  const result = spawnSync('bash', [script, target], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      NODE_ENV: 'test',
      PATH: `${stub}:${process.env.PATH}`,
      STUB: stub,
      GITHUB_OUTPUT: outputFile,
      VERCEL_TOKEN: 'token',
      VERCEL_TEAM_ID: 'team_a',
      VERCEL_PROJECT_ID: 'prj_a',
    },
  });
  const output = Object.fromEntries(
    readFileSync(outputFile, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );
  return { status: result.status, log: `${result.stdout}${result.stderr}`, output };
}

const RELEASES = [
  { uid: 'dpl_three', commit: 2, created: 300 },
  { uid: 'dpl_three_redeploy', commit: 2, created: 290 },
  // Built from production but never served, such as a release whose promote failed.
  { uid: 'dpl_never_served', commit: 1, created: 250, served: false },
  { uid: 'dpl_two', commit: 1, created: 200 },
  { uid: 'dpl_one', commit: 0, created: 100 },
];

test('without a target it goes back to the newest build of another, older commit that served', () => {
  builds('dpl_three', RELEASES);
  const result = plan();
  expect(result.status, result.log).toBe(0);
  expect(result.output).toEqual({
    sha: commit(1),
    deployment: 'dpl_two',
    served: 'dpl_three',
    resume: 'false',
  });
});

test('a second rollback steps back from the build that serves after the first', () => {
  builds('dpl_two', RELEASES);
  const result = plan();
  expect(result.status, result.log).toBe(0);
  expect(result.output.deployment).toBe('dpl_one');
});

test('a named target that production contains goes back to that commit’s build that served', () => {
  builds('dpl_three', RELEASES);
  const result = plan(commit(0));
  expect(result.status, result.log).toBe(0);
  expect(result.output.deployment).toBe('dpl_one');
});

test('a named target whose build serves already resumes the rollback on the same build', () => {
  builds('dpl_two', RELEASES);
  const result = plan(commit(1));
  expect(result.status, result.log).toBe(0);
  expect(result.output).toEqual({ sha: commit(1), deployment: 'dpl_two', served: 'dpl_two', resume: 'true' });
});

test('a commit production never held is refused before any Vercel call', () => {
  builds('dpl_three', RELEASES);
  const result = plan(commit(3));
  expect(result.status).toBe(1);
  expect(result.log).toContain('was never released');
  expect(result.output).toEqual({});
});

test('a short sha, or no older build that served, is refused', () => {
  builds('dpl_three', RELEASES);
  expect(plan(commit(0).slice(0, 7)).log).toContain('full 40-character commit sha');
  builds('dpl_one', RELEASES);
  const oldest = plan();
  expect(oldest.status).toBe(1);
  expect(oldest.log).toContain('that served before');
});

test('a target older than a destructive migration’s named release is refused, on main whether applied or not', () => {
  mkdirSync(join(repo, 'supabase/migrations'), { recursive: true });
  writeFileSync(
    join(repo, 'supabase/migrations/20990101000000_drop.sql'),
    `-- @destructive: after release ${commit(1).slice(0, 8)}: the build from then on reads the new column\ndrop table old;\n`,
  );
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '--quiet', '-m', 'drop');
  builds('dpl_three', RELEASES);
  expect(plan().output.deployment).toBe('dpl_two');
  const tooOld = plan(commit(0));
  expect(tooOld.status).toBe(1);
  expect(tooOld.log).toContain('20990101000000_drop.sql drops what code before');
});
