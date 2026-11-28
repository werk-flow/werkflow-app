import { beforeEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { temporaryDirectory } from './temporary-directory';
import { FULL_RUN_SLOTS } from './ci/full-run';
import { CLOCK_WORK } from './ci/schedule';
import { readWorkflow, workflowsFolder } from './ci-workflow';

const repositoryRoot = resolve(import.meta.dir, '../..');
const candidateScript = join(repositoryRoot, '.github/scripts/release-candidate.sh');

// The owner's target (2026-11-07): PROD is live by 05:00 Berlin on every weekday.
const LIVE_BY = '05:00';
const RELEASE_DECIDES = '03:30';
// The longest start delay measured on an evening line (#184): 440 minutes.
const GITHUB_DELAY_MEASURED_MINUTES = 440;
// A full run, nightly or the release's own: 23 to 29 minutes since 2026-10-31, plus headroom.
const FULL_RUN_MINUTES = 45;
// The slowest full run on record, before the CI overhaul (2026-10-30).
const SLOWEST_FULL_RUN_MINUTES = 62;
// From a green full run to a promoted build: under 7 minutes in the releases so far.
const SHIP_MINUTES = 10;
// ci-alert.timer passes every 10 minutes (werk-flow/werkflow-planning ops/ci-alert.timer).
const TIMER_PASS_MINUTES = 10;

const releaseWorkflow = readFileSync(join(repositoryRoot, workflowsFolder(), 'release.yml'), 'utf8');
const nightlyWorkflow = readFileSync(join(repositoryRoot, workflowsFolder(), 'nightly.yml'), 'utf8');
const mainFullRunWorkflow = readFileSync(
  join(repositoryRoot, workflowsFolder(), 'main-full-run.yml'),
  'utf8',
);
const mainFullRunScript = readFileSync(join(repositoryRoot, '.github/scripts/main-full-run.sh'), 'utf8');

let stub = '';

beforeEach(() => {
  stub = temporaryDirectory('ci-schedule-');
});

/** Minutes after Berlin midnight of an `HH:MM` time. */
function minutesOf(clock: string) {
  const [hours, minutes] = clock.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

test('a release the ci-alert timer dispatches on time at 03:30 is live by 05:00, even with its own slowest full run', () => {
  expect(CLOCK_WORK.release.time).toBe(RELEASE_DECIDES);
  // The timer's pass, then the release's own full run when it finds none, then the ship.
  const liveAt = (ownRun: number) => minutesOf(RELEASE_DECIDES) + TIMER_PASS_MINUTES + ownRun + SHIP_MINUTES;
  expect(liveAt(FULL_RUN_MINUTES)).toBeLessThanOrEqual(minutesOf(LIVE_BY));
  expect(liveAt(SLOWEST_FULL_RUN_MINUTES)).toBeLessThanOrEqual(minutesOf(LIVE_BY));
});

test('no cron and no hold job: the release waits for a dispatch, and the timer finds its own by name', () => {
  // A cron run starts up to 10 hours late and held a runner until 03:30 (werk-flow/werkflow-planning#503).
  expect(Object.keys(readWorkflow('release.yml').at('on') ?? {})).toEqual(['workflow_dispatch']);
  expect(releaseWorkflow).not.toContain('hold-until');
  expect(readWorkflow('release.yml').at('jobs', 'candidate', 'needs')).toBeUndefined();
  // The timer's dispatch (-f scheduled=true) decides as a scheduled run, every other one as asked.
  expect(readWorkflow('release.yml').text('jobs', 'candidate', 'steps', 2, 'env', 'MODE')).toBe(
    "${{ inputs.dry_run && 'dry-run' || inputs.scheduled && 'scheduled' || 'manual' }}",
  );
  // ops/ci-alert.py counts a run of this name as the night's release, and no other dispatch. It
  // dispatches only while it finds this exact line in the raw file, so a folded block would stop it.
  expect(releaseWorkflow).toContain(
    "\nrun-name: ${{ inputs.scheduled && 'Scheduled release' || 'release' }}\n",
  );
});

test("the nightly's full run usually ends before the release decides, so the release reuses it", () => {
  const cron = /- cron: '(\d+) (\d+) \* \* \*'\n {6}timezone: Europe\/Berlin/.exec(nightlyWorkflow);
  expect(cron).not.toBeNull();
  const firesAt = Number(cron?.[2]) * 60 + Number(cron?.[1]);
  // The worst delay measured on an evening line with the slowest full run on record.
  expect(firesAt + GITHUB_DELAY_MEASURED_MINUTES + SLOWEST_FULL_RUN_MINUTES - 24 * 60).toBeLessThanOrEqual(
    minutesOf(RELEASE_DECIDES),
  );
});

test('main gets a full run for landed changes every 6 hours from 06:00 to 20:00 Berlin, and no job waits for it', () => {
  // GitHub starts scheduled runs hours late (#184), so ops/ci-alert.py in werk-flow/werkflow-planning
  // dispatches the workflow, and the workflow decides at once whether a full run is due.
  expect(mainFullRunWorkflow).toMatch(/\non:\n {2}workflow_dispatch:\n\n/);
  expect(mainFullRunWorkflow).not.toMatch(/\n {2}(schedule|push):/);
  expect(mainFullRunWorkflow).not.toMatch(/\bsleep\b/);
  // Berlin's window and the interval belong to the
  // repository's rule owns them (lib/testing/ci/full-run.ts), and the script asks it.
  expect(FULL_RUN_SLOTS).toEqual({ first: '06:00', last: '20:00', intervalMs: 6 * 3600 * 1000 });
  expect(mainFullRunScript).toContain('bun scripts/ci/full-run.ts due');
  // The decision ends in minutes.
  expect(mainFullRunWorkflow).toMatch(
    /\n {2}decide:\n {4}name: Decide\n {4}runs-on: .+\n {4}timeout-minutes: 5\n/,
  );
  // Two full runs on main never overlap: one run decides at a time, and none cancels another.
  expect(mainFullRunWorkflow).toContain(
    'group: main-full-run-${{ github.ref }}\n  cancel-in-progress: false\n',
  );
});

test('a scheduled run whose commit production already passed ends quietly with nothing to do', () => {
  const repository = join(stub, 'repository');
  const git = (...args: string[]) => {
    const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', ...args], {
      cwd: repository,
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    return result.stdout.trim();
  };
  expect(spawnSync('git', ['init', '-qb', 'main', repository]).status).toBe(0);
  git('commit', '--allow-empty', '-qm', 'held');
  const held = git('rev-parse', 'HEAD');
  git('commit', '--allow-empty', '-qm', 'shipped by hand');
  git('update-ref', 'refs/remotes/origin/production', 'HEAD');
  git('checkout', '-q', held);
  // The decision needs no full run here: a GitHub read would fail the run.
  writeFileSync(join(stub, 'curl'), '#!/usr/bin/env bash\nexit 1\n');
  chmodSync(join(stub, 'curl'), 0o755);
  const output = join(stub, 'output');
  for (const mode of ['scheduled', 'dry-run']) {
    writeFileSync(output, '');
    const result = spawnSync('bash', [candidateScript, mode], {
      cwd: repository,
      encoding: 'utf8',
      env: {
        NODE_ENV: 'test',
        PATH: `${stub}:${process.env.PATH}`,
        GITHUB_REF: 'refs/heads/main',
        GITHUB_OUTPUT: output,
      },
    });
    expect(result.status, mode).toBe(0);
    expect(readFileSync(output, 'utf8').trim().split('\n'), mode).toEqual([
      `sha=${held}`,
      'release=false',
      'skip=no-change',
      `skip_reason=production already contains ${held}; a later release shipped it.`,
    ]);
  }
  // A manual run still refuses to move production backwards, and says why.
  const manual = spawnSync('bash', [candidateScript, 'manual'], {
    cwd: repository,
    encoding: 'utf8',
    env: {
      NODE_ENV: 'test',
      PATH: `${stub}:${process.env.PATH}`,
      GITHUB_REF: 'refs/heads/main',
      GITHUB_OUTPUT: output,
    },
  });
  expect(manual.status, manual.stdout + manual.stderr).not.toBe(0);
  expect(manual.stdout + manual.stderr).toContain('production is not an ancestor of main');
});
