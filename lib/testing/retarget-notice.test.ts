// A PR whose base changed hears that it needs a new head, so its watching thread wakes and CI runs
// on the new base (.github/workflows/retarget-notice.yml). The workflow holds no Check: its runs on
// title and body edits must never displace ci.yml's.
import { expect, test } from 'bun:test';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readWorkflow } from './ci-workflow';
import { temporaryDirectory } from './temporary-directory';

const notice = readWorkflow('retarget-notice.yml');

// Records each call; a comment's body lands in `comment`.
const GH_STUB = `#!/usr/bin/env bash
echo "$*" >> "$STUB/gh.calls"
previous=
for argument in "$@"; do
  if test "$previous" = -f && [[ "$argument" == body=* ]]; then printf '%s' "\${argument#body=}" > "$STUB/comment"; fi
  previous="$argument"
done
`;

test('only a base change comments, and the workflow reports no Check', () => {
  // pull_request_target: GitHub starts no pull_request run on a PR that conflicts with its base.
  expect(notice.at('on')).toEqual({ pull_request_target: { types: ['edited'] } });
  expect(notice.at('jobs', 'notice', 'if')).toBe('github.event.changes.base');
  const jobs = notice.at('jobs');
  expect(typeof jobs === 'object' && jobs !== null ? Object.keys(jobs) : jobs).toEqual(['notice']);
  expect(notice.text('jobs', 'notice', 'name')).toBe('Notice');
});

test('it holds the least permissions, checks nothing out and reads every event field as data', () => {
  expect(notice.at('permissions')).toEqual({});
  expect(notice.at('jobs', 'notice', 'permissions')).toEqual({ 'pull-requests': 'write' });
  const steps = notice.at('jobs', 'notice', 'steps');
  expect(Array.isArray(steps) ? steps : []).toHaveLength(1);
  // No action runs, so no checkout of the PR's code: only the step's own script.
  expect(notice.step('notice', 'Comment on the PR')).not.toHaveProperty('uses');
  const script = notice.text('jobs', 'notice', 'steps', 0, 'run');
  expect(script).not.toContain('${{');
  expect(script).not.toContain('git ');
  // The event reaches the script only as the PR's number and base name.
  expect(notice.at('jobs', 'notice', 'steps', 0, 'env')).toEqual({
    GH_TOKEN: '${{ github.token }}',
    PR: '${{ github.event.pull_request.number }}',
    BASE: '${{ github.event.pull_request.base.ref }}',
  });
});

test('the comment names the new base and how to give the PR a new head on it', () => {
  const stub = temporaryDirectory('retarget-notice-');
  writeFileSync(join(stub, 'gh'), GH_STUB);
  chmodSync(join(stub, 'gh'), 0o755);
  const run = notice.runStep('notice', 'Comment on the PR', {
    env: {
      PATH: `${stub}:${process.env.PATH}`,
      STUB: stub,
      GITHUB_REPOSITORY: 'owner/repo',
      GH_TOKEN: 'token',
      PR: '442',
      BASE: 'main',
    },
  });
  expect(run.passed).toBe(true);
  expect(readFileSync(join(stub, 'gh.calls'), 'utf8')).toContain(
    '--method POST repos/owner/repo/issues/442/comments',
  );
  expect(existsSync(join(stub, 'comment')) ? readFileSync(join(stub, 'comment'), 'utf8') : '').toBe(
    'The base changed to `main`. Update the branch (`gh pr update-branch 442` or merge `origin/main`) so CI runs on the new base.',
  );
});
