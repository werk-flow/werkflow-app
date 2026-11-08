// The weekly CI queue check (.github/scripts/ci-queue.sh) measures what a job waited for a runner.
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve(import.meta.dir, '../../.github/scripts/ci-queue.sh');

// Answers like gh: `--jq` runs through real jq, so the script's own filters are under test. A run
// listed in `broken` fails its jobs request.
const GH_STUB = `#!/usr/bin/env bash
filter=.
previous=
run=
for argument in "$@"; do
  if test "$previous" = --jq; then filter="$argument"; fi
  if [[ "$argument" =~ /runs/([0-9]+)/jobs ]]; then run="\${BASH_REMATCH[1]}"; fi
  previous="$argument"
done
case "$*" in
  *'event=pull_request'*) jq -r "$filter" "$STUB/pull_request.json" ;;
  *'event=push&branch=main'*) jq -r "$filter" "$STUB/push.json" ;;
  *'/jobs?'*)
    if grep -qx "$run" "$STUB/broken"; then echo 'HTTP 502' >&2; exit 1; fi
    jq -r "$filter" "$STUB/jobs-$run.json" ;;
  *) echo "unexpected gh $*" >&2; exit 1 ;;
esac
`;

let stub = '';

beforeEach(() => {
  stub = mkdtempSync(join(tmpdir(), 'ci-queue-'));
  writeFileSync(join(stub, 'gh'), GH_STUB);
  chmodSync(join(stub, 'gh'), 0o755);
  writeFileSync(join(stub, 'summary'), '');
  writeFileSync(join(stub, 'broken'), '');
  writeRuns('pull_request', []);
  writeRuns('push', []);
});

afterEach(() => rmSync(stub, { recursive: true, force: true }));

function writeRuns(event: 'pull_request' | 'push', ids: number[]) {
  writeFileSync(join(stub, `${event}.json`), JSON.stringify({ workflow_runs: ids.map((id) => ({ id })) }));
}

const CREATED = Date.parse('2026-11-07T10:00:00Z');

/** A job created at 10:00 that a runner started after `queueSeconds`, or that never got a runner. */
function job(queueSeconds: number | null) {
  const started = queueSeconds === null ? null : new Date(CREATED + queueSeconds * 1000).toISOString();
  return {
    created_at: new Date(CREATED).toISOString().replace('.000', ''),
    started_at: started?.replace('.000', '') ?? null,
    runner_name: queueSeconds === null ? null : 'GitHub Actions 1',
  };
}

function writeJobs(run: number, queues: (number | null)[]) {
  writeFileSync(join(stub, `jobs-${run}.json`), JSON.stringify({ jobs: queues.map(job) }));
}

function check(ceiling: string, extraEnv: Record<string, string> = {}) {
  return spawnSync('bash', [script, ceiling], {
    encoding: 'utf8',
    env: {
      NODE_ENV: 'test',
      PATH: `${stub}:${process.env.PATH}`,
      STUB: stub,
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_STEP_SUMMARY: join(stub, 'summary'),
      ...extraEnv,
    },
  });
}

/** Pull requests wait 0.5, 1, 2 and 10 min, and a job without a runner; main waits 0 and 5 min. */
function writeWeek() {
  writeRuns('pull_request', [11, 12]);
  writeJobs(11, [60, 120, 600, null]);
  writeJobs(12, [30]);
  writeRuns('push', [21]);
  writeJobs(21, [0, 300]);
}

test("a week's queue reports p50 and p90 per kind, without the jobs that never got a runner", () => {
  writeWeek();
  const result = check('10');
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  const summary = readFileSync(join(stub, 'summary'), 'utf8');
  expect(summary).toContain('| Pull requests | 2 | 4 | 1 min | 10 min |');
  expect(summary).toContain('| Pushes to main | 1 | 2 | 0 min | 5 min |');
  expect(result.stdout).toContain('ci-queue: ok');
});

test('a p90 above the ceiling fails the check and names the kind that waited', () => {
  writeWeek();
  const result = check('9');
  expect(result.status).toBe(1);
  expect(result.stdout).toContain(
    '::error title=ci-queue::CI jobs waited longer for a runner than 9 min at p90: pull requests 10 min.',
  );
});

test('a failed jobs request fails the check instead of measuring fewer jobs', () => {
  writeWeek();
  writeFileSync(join(stub, 'broken'), '12\n');
  const result = check('10');
  expect(result.status).not.toBe(0);
  expect(result.stdout).not.toContain('ci-queue: ok');
  expect(readFileSync(join(stub, 'summary'), 'utf8')).toBe('');
});

test('a week without runs passes and says so', () => {
  const result = check('10');
  expect(result.status).toBe(0);
  expect(readFileSync(join(stub, 'summary'), 'utf8')).toContain('| Pull requests | 0 | 0 | - min | - min |');
});

test('the proof run breaks the ceiling', () => {
  writeWeek();
  const result = check('10', { BREAK_CHECK: 'ci-queue' });
  expect(result.status).toBe(1);
  expect(result.stdout).toContain('::warning title=ci-queue::Manual proof run');
});
