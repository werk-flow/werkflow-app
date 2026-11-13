// The merge queue runs ci.yml on its own commit, planned against the queue's base, and a push to
// main whose tree a green queue run passed runs no browser group (.github/workflows/ci.yml).
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ciStep, ciWorkflowAt, ciWorkflowText, runCiStep } from './ci-workflow';

// Answers like gh: `--jq` runs through real jq, so the step's own filter is under test. It records
// each call, fails every call while `broken` exists, and lists `labels-<n>.json` for PR <n>.
const GH_STUB = `#!/usr/bin/env bash
echo "$*" >> "$STUB/gh.calls"
if test -e "$STUB/broken"; then echo 'HTTP 502' >&2; exit 1; fi
filter=.
previous=
for argument in "$@"; do
  if test "$previous" = --jq; then filter="$argument"; fi
  previous="$argument"
done
case "$*" in
  *'/actions/workflows/ci.yml/runs?'*) jq -r "$filter" "$STUB/runs.json" ;;
  *'/issues/'*'/labels'*)
    pr="$(sed -nE 's|.*/issues/([0-9]+)/labels.*|\\1|p' <<< "$*")"
    jq -r "$filter" "$STUB/labels-$pr.json" 2> /dev/null || echo '[]' | jq -r "$filter" ;;
  *) echo "unexpected gh $*" >&2; exit 1 ;;
esac
`;
// Records how the plan step calls the planner.
const BUN_STUB = `#!/usr/bin/env bash
echo "$*" >> "$STUB/bun.calls"
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
  for (const [name, text] of [
    ['gh', GH_STUB],
    ['bun', BUN_STUB],
  ] as const) {
    writeFileSync(join(stub, name), text);
    chmodSync(join(stub, name), 0o755);
  }
  writeFileSync(join(stub, 'output'), '');
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
  return runCiStep(job, name, {
    cwd: repository,
    env: {
      PATH: `${stub}:${process.env.PATH}`,
      STUB: stub,
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_OUTPUT: join(stub, 'output'),
      GITHUB_ENV: join(stub, 'env'),
      ...env,
    },
  });
}

/** The green merge_group runs of ci.yml that the runs list returns, newest first. */
function writeQueueRuns(trees: string[]) {
  writeFileSync(
    join(stub, 'runs.json'),
    JSON.stringify({
      workflow_runs: trees.map((tree, index) => ({
        html_url: `https://github.com/owner/repo/actions/runs/${index + 1}`,
        head_commit: { tree_id: tree },
      })),
    }),
  );
}

const findQueueRun = () => step('plan', "Find the queue's run of this tree", { GH_TOKEN: 'token' });
const plan = (env: Record<string, string>) =>
  step('plan', 'Plan the browser groups', { FULL: '', QUEUE_RUN: '', BASE: '', ...env });

test('the merge queue starts a run that plans against the queue base and is never a draft', () => {
  expect(ciWorkflowAt('on', 'merge_group', 'types')).toEqual(['checks_requested']);
  expect(ciStep('plan', 'Plan the browser groups').env).toHaveProperty(
    'BASE',
    expect.stringContaining("github.event_name == 'merge_group' && github.event.merge_group.base_sha ||"),
  );
  // A merge_group event has no pull_request, so the draft guards hold and Check's DRAFT is false.
  expect(ciWorkflowText('jobs', 'browser', 'if')).toContain('github.event.pull_request.draft != true');
  expect(ciWorkflowAt('jobs', 'check', 'if')).toBe('always()');

  expect(plan({ BASE: 'queue-base-sha' }).passed).toBe(true);
  expect(read('bun.calls')).toBe('scripts/ci-plan.ts --base queue-base-sha\n');
});

test('a push to main whose tree a green queue run passed plans no browser group', () => {
  expect(ciStep('plan', "Find the queue's run of this tree").if).toBe("github.event_name == 'push'");
  const tree = git('rev-parse', 'HEAD^{tree}');
  writeQueueRuns(['0'.repeat(40), tree]);
  const found = findQueueRun();
  expect(found.passed).toBe(true);
  expect(read('gh.calls')).toContain('/actions/workflows/ci.yml/runs?event=merge_group&status=success&');
  expect(read('output')).toBe('run=https://github.com/owner/repo/actions/runs/2\n');

  const planned = plan({ QUEUE_RUN: 'https://github.com/owner/repo/actions/runs/2', BASE: 'before-sha' });
  expect(planned.passed).toBe(true);
  expect(planned.output).toContain('passed on this exact tree, so this push runs no browser group');
  expect(read('bun.calls')).toBe('scripts/ci-plan.ts --base HEAD\n');
});

test('a push whose tree no green queue run passed plans by its diff', () => {
  writeQueueRuns(['0'.repeat(40)]);
  const found = findQueueRun();
  expect(found.passed).toBe(true);
  expect(found.output).not.toContain('::warning');
  expect(read('output')).toBe('run=\n');
  expect(plan({ BASE: 'before-sha' }).passed).toBe(true);
  expect(read('bun.calls')).toBe('scripts/ci-plan.ts --base before-sha\n');
});

test('an unreadable queue run list fails closed: the push runs its browser groups and says why', () => {
  writeFileSync(join(stub, 'broken'), '');
  const found = findQueueRun();
  expect(found.passed).toBe(true);
  expect(found.output).toContain("::warning title=Merge queue::The merge queue's runs could not be read");
  expect(read('output')).toBe('');
});

test('a full run stays full on any event', () => {
  expect(plan({ FULL: 'Nightly', QUEUE_RUN: 'https://github.com/owner/repo/actions/runs/2' }).passed).toBe(
    true,
  );
  expect(read('bun.calls')).toBe('scripts/ci-plan.ts --full Nightly\n');
});

const approval = (env: Record<string, string>) =>
  step('unit', 'Read the list growth approval', {
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
