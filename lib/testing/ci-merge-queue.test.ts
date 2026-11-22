// A merge-queue run takes the list growth approval of every PR in its group, a pull request run only
// its own (.github/workflows/ci.yml, job Fast). lib/testing/ci/ owns the queue's plan and the reuse
// of its tree.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWorkflow } from './ci-workflow';

const ci = readWorkflow('ci.yml');

// Answers like gh: `--jq` runs through real jq, so the step's own filter is under test. It records
// each call and lists `labels-<n>.json` for PR <n>.
const GH_STUB = `#!/usr/bin/env bash
echo "$*" >> "$STUB/gh.calls"
filter=.
previous=
for argument in "$@"; do
  if test "$previous" = --jq; then filter="$argument"; fi
  previous="$argument"
done
case "$*" in
  *'/issues/'*'/labels'*)
    pr="$(sed -nE 's|.*/issues/([0-9]+)/labels.*|\\1|p' <<< "$*")"
    jq -r "$filter" "$STUB/labels-$pr.json" 2> /dev/null || echo '[]' | jq -r "$filter" ;;
  *) echo "unexpected gh $*" >&2; exit 1 ;;
esac
`;

let stub = '';
let repository = '';

function git(...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=CI', '-c', 'user.email=ci@example.invalid', '-c', 'commit.gpgsign=false', ...args],
    { cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
}

function commit(subject: string): string {
  writeFileSync(join(repository, 'file.txt'), subject);
  git('add', 'file.txt');
  git('commit', '--quiet', '--no-verify', '--message', subject);
  return git('rev-parse', 'HEAD');
}

beforeEach(() => {
  stub = mkdtempSync(join(tmpdir(), 'ci-merge-queue-'));
  writeFileSync(join(stub, 'gh'), GH_STUB);
  chmodSync(join(stub, 'gh'), 0o755);
  writeFileSync(join(stub, 'env'), '');
  repository = join(stub, 'repository');
  mkdirSync(repository);
  git('init', '--quiet', '--initial-branch=main');
  commit('Main');
});

afterEach(() => rmSync(stub, { recursive: true, force: true }));

const read = (file: string): string =>
  existsSync(join(stub, file)) ? readFileSync(join(stub, file), 'utf8') : '';

function step(job: string, name: string, env: Record<string, string>) {
  return ci.runStep(job, name, {
    cwd: repository,
    env: {
      PATH: `${stub}:${process.env.PATH}`,
      STUB: stub,
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_ENV: join(stub, 'env'),
      ...env,
    },
  });
}

const approval = (env: Record<string, string>) =>
  step('fast', 'Read the list growth approval', {
    GH_TOKEN: 'token',
    PR: '',
    QUEUE_BRANCH: '',
    QUEUE_BASE: '',
    ...env,
  });

test('a queue run takes the list growth approval of any PR in its group, whose own Check held it', () => {
  const base = git('rev-parse', 'HEAD');
  commit('Ahead in the queue (#11)');
  commit('This entry (#12)');
  const queue = { QUEUE_BRANCH: `refs/heads/gh-readonly-queue/main/pr-12-${base}`, QUEUE_BASE: base };
  expect(approval(queue).passed).toBe(true);
  expect(read('env')).toBe('SHRINK_ONLY_GROWTH_APPROVED=false\n');
  expect(read('gh.calls')).toContain('/issues/11/labels');
  expect(read('gh.calls')).toContain('/issues/12/labels');

  writeFileSync(join(stub, 'env'), '');
  writeFileSync(join(stub, 'labels-11.json'), JSON.stringify([{ name: 'approved: list growth' }]));
  expect(approval(queue).passed).toBe(true);
  expect(read('env')).toBe('SHRINK_ONLY_GROWTH_APPROVED=true\n');
});

test("a pull request run takes only its own PR's approval", () => {
  writeFileSync(join(stub, 'labels-7.json'), JSON.stringify([{ name: 'approved: list growth' }]));
  expect(approval({ PR: '8' }).passed).toBe(true);
  expect(read('env')).toBe('SHRINK_ONLY_GROWTH_APPROVED=false\n');
  expect(read('gh.calls')).not.toContain('/issues/7/');
});
