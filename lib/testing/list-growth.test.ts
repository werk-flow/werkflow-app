// The owner's growth labels, `approved: list growth` and `approved: context growth`, rerun Fast, and
// with it Check, in the PR's own newest CI run on its head (.github/workflows/list-growth.yml).
// Another PR on the same head has runs of its own.
import { expect, test } from 'bun:test';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readWorkflow } from './ci-workflow';
import { GROWTH_APPROVAL_LABELS } from './publication/shrink-only-lists';
import { temporaryDirectory } from './temporary-directory';

const listGrowth = readWorkflow('list-growth.yml');
const SHA = 'a'.repeat(40);

// Answers like gh: `--jq` runs through real jq, so the step's own filters are under test.
const GH_STUB = `#!/usr/bin/env bash
echo "$*" >> "$STUB/gh.calls"
filter=.
previous=
for argument in "$@"; do
  if test "$previous" = --jq; then filter="$argument"; fi
  previous="$argument"
done
case "$*" in
  'api repos/owner/repo/actions/workflows/ci.yml/runs?'*) jq -r "$filter" "$STUB/runs.json" ;;
  'run watch '*) ;;
  'api repos/owner/repo/pulls/5 '*) echo "$SHA" ;;
  'run view '*) echo 77 ;;
  'run rerun '*) ;;
  *) echo "unexpected gh $*" >&2; exit 1 ;;
esac
`;

test("the label reruns the PR's own newest run on its head, never another PR's", () => {
  const stub = temporaryDirectory('list-growth-');
  writeFileSync(join(stub, 'gh'), GH_STUB);
  chmodSync(join(stub, 'gh'), 0o755);
  const run = (id: number, pr: number, sha = SHA) => ({ id, head_sha: sha, pull_requests: [{ number: pr }] });
  writeFileSync(
    join(stub, 'runs.json'),
    JSON.stringify({ workflow_runs: [run(30, 6), run(20, 5, 'b'.repeat(40)), run(10, 5), run(9, 5)] }),
  );
  const result = listGrowth.runStep('rerun', "Rerun the head commit's Fast job", {
    env: {
      PATH: `${stub}:${process.env.PATH}`,
      STUB: stub,
      GH_TOKEN: 'token',
      GH_REPO: 'owner/repo',
      PR: '5',
      SHA,
    },
  });
  expect(result.output).toContain('Reran Fast and Check in CI run 10');
  expect(result.passed).toBe(true);
  expect(readFileSync(join(stub, 'gh.calls'), 'utf8')).toContain('run rerun 10 --job 77');
});

test('each of the owner’s growth labels reruns Fast, and so does no other label', () => {
  const condition = listGrowth.text('jobs', 'rerun', 'if');
  const named = [...condition.matchAll(/github\.event\.label\.name == '([^']+)'/g)].map((match) => match[1]);
  expect(named.toSorted()).toEqual([...GROWTH_APPROVAL_LABELS].toSorted());
  expect(listGrowth.text('concurrency', 'group')).toContain(condition.replace(/^\$\{\{\s*|\s*\}\}$/g, ''));
});
