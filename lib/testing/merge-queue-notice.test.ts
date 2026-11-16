// A failed merge queue run comments on its PR, so the PR's watching thread wakes
// (.github/workflows/merge-queue-notice.yml).
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWorkflow } from './ci-workflow';

const notice = readWorkflow('merge-queue-notice.yml');
const RUN_SHA = 'a'.repeat(40);
const RUN_URL = 'https://github.com/owner/repo/actions/runs/9';

// Answers like gh: `--jq` runs through real jq, so the step's own filters are under test. A missing
// answer file fails the call as an unreadable API would. A comment's body lands in `comment`.
const GH_STUB = `#!/usr/bin/env bash
echo "$*" >> "$STUB/gh.calls"
filter=.
previous=
for argument in "$@"; do
  if test "$previous" = --jq; then filter="$argument"; fi
  if test "$previous" = -f && [[ "$argument" == body=* ]]; then printf '%s' "\${argument#body=}" > "$STUB/comment"; fi
  previous="$argument"
done
answer() { if test -e "$STUB/$1"; then jq -r "$filter" "$STUB/$1"; else echo 'HTTP 502' >&2; exit 1; fi; }
case "$*" in
  'api graphql '*) answer pr.json ;;
  *'/actions/runs/9/jobs?'*) answer jobs.json ;;
  *'--method POST repos/owner/repo/issues/'*'/comments'*) ;;
  *) echo "unexpected gh $*" >&2; exit 1 ;;
esac
`;

let stub = '';

beforeEach(() => {
  stub = mkdtempSync(join(tmpdir(), 'merge-queue-notice-'));
  writeFileSync(join(stub, 'gh'), GH_STUB);
  chmodSync(join(stub, 'gh'), 0o755);
});

afterEach(() => rmSync(stub, { recursive: true, force: true }));

const read = (file: string): string =>
  existsSync(join(stub, file)) ? readFileSync(join(stub, file), 'utf8') : '';

function pullRequest(state: string, queuedSha?: string) {
  const entry = queuedSha ? { headCommit: { oid: queuedSha } } : null;
  writeFileSync(
    join(stub, 'pr.json'),
    JSON.stringify({ data: { repository: { pullRequest: { state, mergeQueueEntry: entry } } } }),
  );
}

function jobs(list: { name: string; conclusion: string }[]) {
  writeFileSync(join(stub, 'jobs.json'), JSON.stringify({ jobs: list }));
}

function comment(branch = `gh-readonly-queue/main/pr-442-${'b'.repeat(40)}`) {
  return notice.runStep('notice', 'Comment on the PR', {
    env: {
      PATH: `${stub}:${process.env.PATH}`,
      STUB: stub,
      GITHUB_REPOSITORY: 'owner/repo',
      GH_TOKEN: 'token',
      QUEUE_BRANCH: branch,
      RUN_SHA,
      RUN_ID: '9',
      RUN_URL,
    },
  });
}

test('only a failed or timed out run of CI on a merge queue entry comments', () => {
  expect(notice.at('on')).toEqual({ workflow_run: { workflows: ['CI'], types: ['completed'] } });
  const condition = notice.text('jobs', 'notice', 'if').replace(/\s+/g, ' ');
  expect(condition).toBe(
    "github.event.workflow_run.event == 'merge_group' && (github.event.workflow_run.conclusion == 'failure' || github.event.workflow_run.conclusion == 'timed_out')",
  );
});

test('it holds the least permissions, checks nothing out and reads every event field as data', () => {
  expect(notice.at('permissions')).toEqual({});
  expect(notice.at('jobs', 'notice', 'permissions')).toEqual({ actions: 'read', 'pull-requests': 'write' });
  const steps = notice.at('jobs', 'notice', 'steps');
  expect(Array.isArray(steps) ? steps : []).toHaveLength(1);
  const script = notice.text('jobs', 'notice', 'steps', 0, 'run');
  expect(notice.step('notice', 'Comment on the PR')).not.toHaveProperty('uses');
  expect(script).not.toContain('${{');
  expect(script).not.toContain('git ');
});

test("a failed run comments on the PR named by the queue's branch, with the run and its failed jobs", () => {
  pullRequest('OPEN');
  jobs([
    { name: 'Unit', conclusion: 'success' },
    { name: 'Browser `3` @owner', conclusion: 'failure' },
    { name: 'Build', conclusion: 'timed_out' },
    { name: 'Check', conclusion: 'failure' },
  ]);
  const run = comment();
  expect(run.passed).toBe(true);
  expect(read('gh.calls')).toContain('-F number=442 ');
  expect(read('gh.calls')).toContain('--method POST repos/owner/repo/issues/442/comments');
  const body = read('comment');
  expect(body).toStartWith(
    `The merge queue's run of this PR failed, so GitHub took the PR out of the queue: ${RUN_URL}\n`,
  );
  expect(body).toContain('Failed jobs:\n- `Browser 3 @owner`\n- `Build`\n- `Check`\n');
  expect(body).not.toContain('Unit');
  expect(body).toContain('`gh pr view 442 --json state,autoMergeRequest`');
  expect(body).toContain('`gh pr merge 442 --squash --auto`');
});

test('a PR still queued on the failed commit hears of it, since the queue is about to take it out', () => {
  pullRequest('OPEN', RUN_SHA);
  jobs([{ name: 'Check', conclusion: 'failure' }]);
  expect(comment().passed).toBe(true);
  expect(read('comment')).toContain('- `Check`');
});

test('a PR the queue tests again on another commit, or that merged or closed, gets no comment', () => {
  jobs([{ name: 'Check', conclusion: 'failure' }]);
  for (const [state, queued, reason] of [
    ['OPEN', 'c'.repeat(40), 'tests PR #442 again on another commit'],
    ['MERGED', undefined, 'PR #442 is MERGED'],
    ['CLOSED', undefined, 'PR #442 is CLOSED'],
  ] as const) {
    pullRequest(state, queued);
    const run = comment();
    expect(run.passed).toBe(true);
    expect(run.output).toContain(reason);
    expect(read('comment')).toBe('');
  }
});

test('an unreadable PR state or job list still comments, so no thread sleeps', () => {
  const run = comment();
  expect(run.passed).toBe(true);
  expect(run.output).toContain('::warning title=Merge queue notice::The state of PR #442 could not be read');
  expect(read('comment')).toContain('- The failed jobs could not be read. The run names them.');
});

test('a run on no merge queue branch fails and comments on nothing', () => {
  pullRequest('OPEN');
  for (const branch of ['main', 'feature/pr-442-abc', `gh-readonly-queue/main/pr-x-${RUN_SHA}`]) {
    const run = comment(branch);
    expect(run.passed).toBe(false);
    expect(run.output).toContain('The run is on no merge queue branch');
  }
  expect(read('gh.calls')).toBe('');
});
