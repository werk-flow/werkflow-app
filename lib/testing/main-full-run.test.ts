import { afterEach, beforeEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { workflowsFolder } from './ci-workflow';

const repositoryRoot = resolve(import.meta.dir, '../..');
const script = join(repositoryRoot, '.github/scripts/main-full-run.sh');
const HOUR = 3600;

// Answers like gh: `--jq` runs through real jq, so the script's own filters are under test.
const GH_STUB = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB/gh.log"
filter=.
previous=
for argument in "$@"; do
  if test "$previous" = --jq; then filter="$argument"; fi
  previous="$argument"
done
case "$*" in
  *'/check-runs?'*)
    call="$*"
    commit="\${call#*commits/}"
    file="$STUB/checks/\${commit%%/*}.json"
    test -f "$file" || file="$STUB/checks/none.json"
    jq -r "$filter" "$file" ;;
  *'/commits?'*) test -f "$STUB/fail-commits" && exit 1; jq -r "$filter" "$STUB/commits.json" ;;
  *'/jobs?'*) jq -r "$filter" "$STUB/jobs.json" ;;
  *) exit 1 ;;
esac
`;

// The job log endpoint: logs/<job id>, or a failed request.
const CURL_STUB = `#!/usr/bin/env bash
url="\${*: -1}"
job="\${url%/logs}"
job="\${job##*/}"
cat "$STUB/logs/$job" 2> /dev/null || exit 22
`;

// The repository's rule (scripts/ci/full-run.ts): it records what the script passed and answers.
const BUN_STUB = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB/bun.log"
test -f "$STUB/fail-bun" && exit 1
echo 'run=stub' >> "$GITHUB_OUTPUT"
echo '{"run":true,"reason":"stub"}'
`;

let stub = '';

beforeEach(() => {
  stub = mkdtempSync(join(tmpdir(), 'main-full-run-'));
  for (const [name, body] of [
    ['gh', GH_STUB],
    ['curl', CURL_STUB],
    ['bun', BUN_STUB],
  ] as const) {
    writeFileSync(join(stub, name), body);
    chmodSync(join(stub, name), 0o755);
  }
  mkdirSync(join(stub, 'checks'));
  mkdirSync(join(stub, 'logs'));
  writeFileSync(join(stub, 'checks/none.json'), JSON.stringify({ check_runs: [] }));
  writeFileSync(join(stub, 'jobs.json'), JSON.stringify({ jobs: [] }));
  writeFileSync(join(stub, 'gh.log'), '');
  writeFileSync(join(stub, 'bun.log'), '');
});

afterEach(() => rmSync(stub, { recursive: true, force: true }));

/** Main's commits, newest first: `c0` is the run's own. */
function writeCommits(count: number) {
  const commits = Array.from({ length: count }, (_, index) => ({
    sha: `c${index}`.padEnd(40, '0'),
    commit: { message: `Change ${index}\n\nBody ${index}` },
  }));
  writeFileSync(join(stub, 'commits.json'), JSON.stringify(commits));
  return commits.map((commit) => commit.sha);
}

type Check = { name: string; status: string; conclusion: string | null; started_at: string | null };

/** The check runs of one full run on `sha` that started at `startedAt`; `check` is `Full run / Check`'s state. */
function writeFullRun(
  sha: string,
  startedAt: string,
  check: 'running' | 'success' | 'failure',
  app = 'github-actions',
) {
  const checks: Check[] = [
    { name: 'Full run / Plan', status: 'completed', conclusion: 'success', started_at: startedAt },
    check === 'running'
      ? { name: 'Full run / Browser 1', status: 'in_progress', conclusion: null, started_at: null }
      : { name: 'Full run / Browser 1', status: 'completed', conclusion: check, started_at: null },
    // The push's own diff run, which is no full run.
    { name: 'Check', status: 'completed', conclusion: 'success', started_at: '2026-11-13T00:00:00Z' },
  ];
  if (check !== 'running')
    checks.push({ name: 'Full run / Check', status: 'completed', conclusion: check, started_at: startedAt });
  writeFileSync(
    join(stub, `checks/${sha}.json`),
    JSON.stringify({ check_runs: checks.map((entry) => ({ ...entry, app: { slug: app } })) }),
  );
}

function run(action: string) {
  writeFileSync(join(stub, 'output'), '');
  return spawnSync('bash', [script, action], {
    encoding: 'utf8',
    env: {
      NODE_ENV: 'test',
      PATH: `${stub}:${process.env.PATH}`,
      STUB: stub,
      GH_TOKEN: 'token',
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_SERVER_URL: 'https://github.test',
      GITHUB_SHA: 'c0'.padEnd(40, '0'),
      GITHUB_RUN_ID: '7',
      GITHUB_OUTPUT: join(stub, 'output'),
    },
  });
}

/** What the decision passed to the repository's rule. */
function decide() {
  const result = run('decide');
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(readFileSync(join(stub, 'output'), 'utf8')).toBe('run=stub\n');
  expect(result.stdout).toBe('::notice title=Full run on main::{"run":true,"reason":"stub"}\n');
  return readFileSync(join(stub, 'bun.log'), 'utf8').trim();
}

// 2026-11-13 is winter time: Berlin is UTC+1.
const NOON = '2026-11-13T11:00:00Z';
const hoursBefore = (instant: string, hours: number) =>
  new Date(Date.parse(instant) - hours * HOUR * 1000).toISOString().replace('.000', '');
const epoch = (instant: string) => Date.parse(instant) / 1000;

test("the decision passes main's newest full run, ended or running, to the repository's rule", () => {
  const [, , third] = writeCommits(5);
  writeFullRun(third ?? '', hoursBefore(NOON, 3), 'success');
  expect(decide()).toBe(`scripts/ci/full-run.ts due --run ${third},${epoch(hoursBefore(NOON, 3))},ended`);
  writeFileSync(join(stub, 'bun.log'), '');
  writeFullRun(third ?? '', hoursBefore(NOON, 1), 'running');
  expect(decide()).toBe(`scripts/ci/full-run.ts due --run ${third},${epoch(hoursBefore(NOON, 1))},running`);
});

test("a red newest full run counts like a green one, and the head's own run is the newest", () => {
  const [head, second] = writeCommits(3);
  writeFullRun(second ?? '', hoursBefore(NOON, 4), 'failure');
  writeFullRun(head ?? '', hoursBefore(NOON, 2), 'failure');
  expect(decide()).toBe(`scripts/ci/full-run.ts due --run ${head},${epoch(hoursBefore(NOON, 2))},ended`);
});

test('a cancelled or timed-out full run tested nothing, so an older one decides', () => {
  const [head, second] = writeCommits(3);
  writeFullRun(second ?? '', hoursBefore(NOON, 4), 'success');
  for (const conclusion of ['cancelled', 'timed_out']) {
    writeFileSync(
      join(stub, `checks/${head}.json`),
      JSON.stringify({
        check_runs: [
          { name: 'Full run / Check', status: 'completed', conclusion, started_at: hoursBefore(NOON, 1) },
        ].map((entry) => ({ ...entry, app: { slug: 'github-actions' } })),
      }),
    );
    writeFileSync(join(stub, 'bun.log'), '');
    expect(decide()).toBe(`scripts/ci/full-run.ts due --run ${second},${epoch(hoursBefore(NOON, 4))},ended`);
  }
});

test('an older full run still running reaches the rule beside the newest ended one', () => {
  const [, second, , fourth] = writeCommits(5);
  writeFullRun(second ?? '', hoursBefore(NOON, 4), 'success');
  writeFullRun(fourth ?? '', hoursBefore(NOON, 1), 'running');
  expect(decide()).toBe(
    `scripts/ci/full-run.ts due --run ${second},${epoch(hoursBefore(NOON, 4))},ended --run ${fourth},${epoch(hoursBefore(NOON, 1))},running`,
  );
});

test("main without a full run on its last 100 commits, or with only another app's, passes none", () => {
  const [head] = writeCommits(100);
  writeFullRun(head ?? '', hoursBefore(NOON, 1), 'success', 'some-app');
  expect(decide()).toBe('scripts/ci/full-run.ts due');
});

test('a failed request or a failed rule fails the decision instead of guessing', () => {
  writeCommits(2);
  writeFileSync(join(stub, 'fail-commits'), '');
  expect(run('decide').status).not.toBe(0);
  expect(readFileSync(join(stub, 'bun.log'), 'utf8')).toBe('');
  rmSync(join(stub, 'fail-commits'));
  writeFileSync(join(stub, 'fail-bun'), '');
  expect(run('decide').status).not.toBe(0);
  expect(readFileSync(join(stub, 'output'), 'utf8')).toBe('');
});

test('the alert detail names the failed groups and the commits since the last green full run', () => {
  const [head, second, third, fourth] = writeCommits(6);
  writeFullRun(head ?? '', hoursBefore(NOON, 1), 'failure');
  writeFullRun(third ?? '', hoursBefore(NOON, 4), 'failure');
  writeFullRun(fourth ?? '', hoursBefore(NOON, 7), 'success');
  writeFileSync(
    join(stub, 'jobs.json'),
    JSON.stringify({
      jobs: [
        { id: 1, name: 'Full run / Browser 4', conclusion: 'failure' },
        { id: 2, name: 'Full run / Browser 5', conclusion: 'timed_out' },
        { id: 3, name: 'Full run / Browser 6', conclusion: 'success' },
        { id: 4, name: 'Full run / Static gates', conclusion: 'failure' },
      ],
    }),
  );
  writeFileSync(
    join(stub, 'logs/1'),
    [
      '2026-11-13T10:01:00Z [verify] audit:layout:job: failed; Error: \u001b[2mexpect\u001b[22m',
      '2026-11-13T10:02:00Z [verify] audit:pagination: passed',
      '2026-11-13T10:03:00Z [verify] audit:layout:job: failed',
    ].join('\n'),
  );
  writeFileSync(join(stub, 'logs/2'), '2026-11-13T10:04:00Z [verify] golden:kalender: failed\n');
  writeFileSync(join(stub, 'logs/3'), '2026-11-13T10:04:00Z [verify] golden:aufgaben: failed\n');
  const result = run('context');
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(result.stdout).toBe(
    [
      'Failed groups:',
      '',
      '- `audit:layout:job`',
      '- `golden:kalender`',
      '- The log of job 4 could not be read.',
      '',
      `Commits since the last green full run, on ${fourth?.slice(0, 9)} (https://github.test/owner/repo/compare/${fourth}...${head}):`,
      '',
      '```text',
      `${head?.slice(0, 9)} Change 0`,
      `${second?.slice(0, 9)} Change 1`,
      `${third?.slice(0, 9)} Change 2`,
      '```',
      '',
    ].join('\n'),
  );
});

test('a commit whose green full run a later red attempt replaced is still the last green one', () => {
  const [head, second] = writeCommits(3);
  writeFullRun(head ?? '', hoursBefore(NOON, 1), 'failure');
  const attempts = [
    {
      name: 'Full run / Check',
      status: 'completed',
      conclusion: 'failure',
      started_at: hoursBefore(NOON, 2),
    },
    {
      name: 'Full run / Check',
      status: 'completed',
      conclusion: 'success',
      started_at: hoursBefore(NOON, 6),
    },
  ];
  writeFileSync(
    join(stub, `checks/${second}.json`),
    JSON.stringify({ check_runs: attempts.map((entry) => ({ ...entry, app: { slug: 'github-actions' } })) }),
  );
  const result = run('context');
  expect(result.status).toBe(0);
  expect(result.stdout).toContain(`Commits since the last green full run, on ${second?.slice(0, 9)} `);
  expect(result.stdout).toContain(`\`\`\`text\n${head?.slice(0, 9)} Change 0\n\`\`\`\n`);
  // The lookup asks for every attempt, not only the newest.
  expect(readFileSync(join(stub, 'gh.log'), 'utf8')).toContain(
    'check_name=Full%20run%20%2F%20Check&filter=all',
  );
});

test('the alert detail says so when no green full run is in reach', () => {
  writeCommits(3);
  const result = run('context');
  expect(result.status).toBe(0);
  expect(result.stdout).toBe(
    [
      'Failed groups:',
      '',
      'None named in the logs; see the failed steps above.',
      '',
      'No green full run on the last 100 commits.',
      '',
    ].join('\n'),
  );
});

test('the alert speaks for a full run or a failed decision, never for a skipped one', () => {
  const workflow = readFileSync(join(repositoryRoot, workflowsFolder(), 'main-full-run.yml'), 'utf8');
  const alert = workflow.slice(workflow.indexOf('\n  alert:'));
  expect(alert).toContain('needs: [decide, full]\n');
  const condition = /\n {4}if: >-\n((?: {6}.+\n)+)/.exec(alert)?.[1]?.replace(/\s+/g, ' ').trim();
  expect(condition).toBe(
    "!cancelled() && github.ref == 'refs/heads/main' && (needs.decide.result == 'failure' || needs.decide.outputs.run == 'true')",
  );
});
