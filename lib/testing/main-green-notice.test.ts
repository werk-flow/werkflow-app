// When main turns green again, each open PR whose Check failed gets one comment, so its watching
// thread wakes (.github/workflows/main-green-notice.yml).
import { afterEach, beforeEach, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWorkflow } from './ci-workflow';

const notice = readWorkflow('main-green-notice.yml');
const STEP = 'Comment on PRs with a failed Check';
const GREEN_SHA = 'a'.repeat(40);
const MARKER = `<!-- main-green-notice ${GREEN_SHA} -->`;

// Answers like gh: `--jq` runs through real jq, so the step's own filters are under test. A missing
// answer file fails the call as an unreadable API would. A comment on PR <n> lands in `posted-<n>`;
// a file `refuse-<n>` fails it.
const GH_STUB = `#!/usr/bin/env bash
echo "$*" >> "$STUB/gh.calls"
filter=.
previous=
body=
for argument in "$@"; do
  if test "$previous" = --jq; then filter="$argument"; fi
  if test "$previous" = -f && [[ "$argument" == body=* ]]; then body="\${argument#body=}"; fi
  previous="$argument"
done
answer() { if test -e "$STUB/$1"; then jq -r "$filter" "$STUB/$1"; else echo 'HTTP 502' >&2; exit 1; fi; }
if [[ "$*" =~ ^api\\ repos/owner/repo/actions/workflows/7/runs\\?branch=main\\&event=push\\&status=completed ]]; then answer runs.json
elif [[ "$*" =~ ^api\\ --paginate\\ repos/owner/repo/pulls\\?state=open\\&base=main\\&per_page=100 ]]; then
  for page in "$STUB"/prs*.json; do answer "\${page##*/}"; done
elif [[ "$*" =~ ^api\\ repos/owner/repo/commits/([0-9a-f]+)/check-runs\\?check_name=Check ]]; then answer "checks-\${BASH_REMATCH[1]}.json"
elif [[ "$*" =~ ^api\\ --paginate\\ repos/owner/repo/issues/([0-9]+)/comments ]]; then answer "comments-\${BASH_REMATCH[1]}.json"
elif [[ "$*" =~ ^api\\ --method\\ POST\\ repos/owner/repo/issues/([0-9]+)/comments ]]; then
  if test -e "$STUB/refuse-\${BASH_REMATCH[1]}"; then echo 'HTTP 502' >&2; exit 1; fi
  printf '%s' "$body" > "$STUB/posted-\${BASH_REMATCH[1]}"
else echo "unexpected gh $*" >&2; exit 1
fi
`;

let stub = '';

beforeEach(() => {
  stub = mkdtempSync(join(tmpdir(), 'main-green-notice-'));
  writeFileSync(join(stub, 'gh'), GH_STUB);
  chmodSync(join(stub, 'gh'), 0o755);
});

afterEach(() => rmSync(stub, { recursive: true, force: true }));

const write = (file: string, value: unknown) => writeFileSync(join(stub, file), JSON.stringify(value));
const read = (file: string): string =>
  existsSync(join(stub, file)) ? readFileSync(join(stub, file), 'utf8') : '';
const commented = () =>
  readdirSync(stub)
    .filter((file) => file.startsWith('posted-'))
    .map((file) => Number(file.slice('posted-'.length)))
    .sort((left, right) => left - right);

/** Earlier completed push runs of main, newest first, beside this run (number 50). */
function earlierRuns(...conclusions: string[]) {
  const earlier = conclusions.map((conclusion, index) => ({ run_number: 49 - index, conclusion }));
  write('runs.json', { workflow_runs: [{ run_number: 50, conclusion: 'success' }, ...earlier] });
}

const head = (pr: number) => pr.toString(16).padStart(40, 'c');

/** An open PR to main whose Check runs on its head ended with `checks`, oldest first. */
function pullRequest(pr: number, options: { draft?: boolean; checks?: string[]; comments?: string[] }) {
  const runs = (options.checks ?? []).map((conclusion, index) => ({
    conclusion,
    started_at: `2026-11-13T1${index}:00:00Z`,
  }));
  write(`checks-${head(pr)}.json`, { check_runs: runs });
  write(
    `comments-${pr}.json`,
    (options.comments ?? []).map((body, id) => ({ id: id + 1, body })),
  );
  return { number: pr, draft: options.draft ?? false, head: { sha: head(pr) } };
}

function notify() {
  return notice.runStep('notice', STEP, {
    env: {
      PATH: `${stub}:${process.env.PATH}`,
      STUB: stub,
      GITHUB_REPOSITORY: 'owner/repo',
      GH_TOKEN: 'token',
      WORKFLOW_ID: '7',
      RUN_NUMBER: '50',
      RUN_SHA: GREEN_SHA,
    },
  });
}

test('only a successful push run of CI on main starts it', () => {
  expect(notice.at('on')).toEqual({ workflow_run: { workflows: ['CI'], types: ['completed'] } });
  expect(notice.text('jobs', 'notice', 'if').replace(/\s+/g, ' ')).toBe(
    "github.event.workflow_run.event == 'push' && github.event.workflow_run.head_branch == 'main' && github.event.workflow_run.conclusion == 'success'",
  );
});

test('it holds the least permissions, checks nothing out and reads every event field as data', () => {
  expect(notice.at('permissions')).toEqual({});
  expect(notice.at('jobs', 'notice', 'permissions')).toEqual({
    actions: 'read',
    checks: 'read',
    'pull-requests': 'write',
  });
  const steps = notice.at('jobs', 'notice', 'steps');
  expect(Array.isArray(steps) ? steps : []).toHaveLength(1);
  expect(notice.step('notice', STEP)).not.toHaveProperty('uses');
  const script = notice.text('jobs', 'notice', 'steps', 0, 'run');
  expect(script).not.toContain('${{');
  expect(script).not.toContain('git ');
  expect(notice.text('jobs', 'notice', 'steps', 0, 'env', 'GH_TOKEN')).toBe('${{ github.token }}');
});

test('a red-to-green turn comments once on each open PR whose latest Check failed, and on no other', () => {
  earlierRuns('cancelled', 'failure', 'success');
  write('prs.json', [
    pullRequest(441, { checks: ['success', 'failure'] }),
    pullRequest(442, { checks: ['timed_out'] }),
    pullRequest(443, { draft: true, checks: ['failure'] }),
    pullRequest(444, { checks: ['failure', 'success'] }),
    pullRequest(445, { checks: [] }),
    pullRequest(446, { checks: ['failure'], comments: ['Sol approved.', `Earlier notice\n\n${MARKER}`] }),
    pullRequest(447, {
      checks: ['failure'],
      comments: ['<!-- main-green-notice ' + 'b'.repeat(40) + ' -->'],
    }),
  ]);
  const run = notify();
  expect(run.passed).toBe(true);
  expect(commented()).toEqual([441, 442, 447]);
  expect(read('posted-441')).toBe(
    `\`main\` is green again at ${GREEN_SHA}. Merge \`main\` into this branch and let CI run again.\n\n${MARKER}`,
  );
  expect(run.output).toContain(`PR #446 already heard that main is green at ${GREEN_SHA}`);
  expect(run.output).toContain('3 PRs heard of it');
  expect(read('gh.calls')).not.toContain(`commits/${head(443)}`);
});

test('a green-to-green run, or one after no earlier run, comments nowhere', () => {
  for (const earlier of [['success', 'failure'], ['cancelled', 'skipped', 'success'], []]) {
    earlierRuns(...earlier);
    write('prs.json', [pullRequest(441, { checks: ['failure'] })]);
    const run = notify();
    expect(run.passed).toBe(true);
    expect(run.output).toContain('so main did not turn green now');
    expect(commented()).toEqual([]);
    expect(read('gh.calls')).not.toContain('/pulls?');
  }
});

test('an unreadable Check or comment list skips that PR, lets the others hear of it, then fails the run', () => {
  earlierRuns('failure');
  write('prs.json', [
    pullRequest(441, { checks: ['success'] }),
    pullRequest(442, { checks: ['failure'], comments: [MARKER] }),
    pullRequest(443, { checks: ['failure'] }),
  ]);
  rmSync(join(stub, `checks-${head(441)}.json`));
  rmSync(join(stub, 'comments-442.json'));
  const run = notify();
  expect(run.passed).toBe(false);
  expect(run.output).toContain('The Check of PR #441 could not be read, so it gets no comment');
  expect(run.output).toContain('The comments of PR #442 could not be read, so it gets no comment');
  expect(commented()).toEqual([443]);
});

test('every page of open PRs is read, so a PR past the first hundred hears of it', () => {
  earlierRuns('failure');
  write('prs.json', [pullRequest(441, { checks: ['success'] })]);
  write('prs2.json', [pullRequest(542, { checks: ['failure'] })]);
  const run = notify();
  expect(run.passed).toBe(true);
  expect(read('gh.calls')).toContain(
    'api --paginate repos/owner/repo/pulls?state=open&base=main&per_page=100',
  );
  expect(commented()).toEqual([542]);
});

test('an unreadable previous run, or an event without a commit, fails and comments on nothing', () => {
  write('prs.json', [pullRequest(441, { checks: ['failure'] })]);
  const unread = notify();
  expect(unread.passed).toBe(false);
  expect(unread.output).toContain('The previous run of main could not be read');
  earlierRuns('failure');
  const malformed = notice.runStep('notice', STEP, {
    env: {
      PATH: `${stub}:${process.env.PATH}`,
      STUB: stub,
      GITHUB_REPOSITORY: 'owner/repo',
      WORKFLOW_ID: '7',
      RUN_NUMBER: '50',
      RUN_SHA: 'main',
    },
  });
  expect(malformed.passed).toBe(false);
  expect(malformed.output).toContain('The event names no workflow, run number or commit');
  expect(commented()).toEqual([]);
});

test('a comment that fails still lets the other PRs hear of it, then fails the run', () => {
  earlierRuns('failure');
  write('prs.json', [pullRequest(441, { checks: ['failure'] }), pullRequest(442, { checks: ['failure'] })]);
  writeFileSync(join(stub, 'refuse-441'), '');
  const run = notify();
  expect(run.passed).toBe(false);
  expect(run.output).toContain('The comment on PR #441 failed');
  expect(commented()).toEqual([442]);
});
