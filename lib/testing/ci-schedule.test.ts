import { afterEach, beforeEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '../..');
const holdScript = join(repositoryRoot, '.github/scripts/hold-until.sh');
const candidateScript = join(repositoryRoot, '.github/scripts/release-candidate.sh');
const HOUR = 3600;
const LEG = 345 * 60;

// The owner's target (2026-11-07): PROD is live by 05:00 Berlin on every weekday.
const LIVE_BY = '05:00';
const RELEASE_DECIDES = '03:30';
// GitHub starts this repository's scheduled runs up to 10 hours late (werk-flow/werkflow-app#184).
const GITHUB_DELAY_MAX_MINUTES = 10 * 60;
// The longest start delay measured on an evening line (#184): 440 minutes.
const GITHUB_DELAY_MEASURED_MINUTES = 440;
// A full run, nightly or the release's own: 23 to 29 minutes since 2026-10-31, plus headroom.
const FULL_RUN_MINUTES = 45;
// The slowest full run on record, before the CI overhaul (2026-10-30).
const SLOWEST_FULL_RUN_MINUTES = 62;
// From a green full run to a promoted build: under 7 minutes in the releases so far.
const SHIP_MINUTES = 10;

const releaseWorkflow = readFileSync(join(repositoryRoot, '.github/workflows/release.yml'), 'utf8');
const nightlyWorkflow = readFileSync(join(repositoryRoot, '.github/workflows/nightly.yml'), 'utf8');

let stub = '';

beforeEach(() => {
  stub = mkdtempSync(join(tmpdir(), 'ci-schedule-'));
  writeFileSync(join(stub, 'date'), '#!/usr/bin/env bash\necho "$NOW"\n');
  writeFileSync(join(stub, 'sleep'), '#!/usr/bin/env bash\necho "$1" > "$STUB/slept"\n');
  chmodSync(join(stub, 'date'), 0o755);
  chmodSync(join(stub, 'sleep'), 0o755);
});

afterEach(() => rmSync(stub, { recursive: true, force: true }));

/** The seconds one leg of the hold sleeps when it starts at `instant`. */
function secondsHeldFrom(instant: string) {
  rmSync(join(stub, 'slept'), { force: true });
  const now = Date.parse(instant) / 1000;
  const result = spawnSync('bash', [holdScript, RELEASE_DECIDES], {
    encoding: 'utf8',
    env: { NODE_ENV: 'test', PATH: `${stub}:${process.env.PATH}`, STUB: stub, NOW: String(now) },
  });
  expect(result.status).toBe(0);
  return existsSync(join(stub, 'slept')) ? Number(readFileSync(join(stub, 'slept'), 'utf8')) : 0;
}

/** Minutes after Berlin midnight of an `HH:MM` time. */
function minutesOf(clock: string) {
  const [hours, minutes] = clock.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

test('PROD is live by 05:00 even when GitHub starts the release 10 hours late', () => {
  const cron = /- cron: '(\d+) (\d+) \* \* 0-4'\n {6}timezone: Europe\/Berlin/.exec(releaseWorkflow);
  expect(cron).not.toBeNull();
  const firesAt = Number(cron?.[2]) * 60 + Number(cron?.[1]);
  /** When PROD is live: the release starts `delay` late, and the nightly shares its line, so it starts
   * no later. ci.yml queues full runs on one commit, so the release's own run may wait for the nightly. */
  const liveAt = (delay: number, nightly: number, ownRun: number) => {
    const latestStart = firesAt + delay - 24 * 60;
    const decides = Math.max(latestStart, minutesOf(RELEASE_DECIDES));
    return Math.max(decides, latestStart + nightly) + ownRun + SHIP_MINUTES;
  };
  // GitHub's stated worst delay with today's full runs (23 to 29 minutes since 2026-10-31), with margin.
  expect(liveAt(GITHUB_DELAY_MAX_MINUTES, FULL_RUN_MINUTES, FULL_RUN_MINUTES)).toBeLessThanOrEqual(
    minutesOf(LIVE_BY),
  );
  // The worst delay measured on an evening line with the slowest full runs on record (62 minutes, 2026-10-30).
  expect(
    liveAt(GITHUB_DELAY_MEASURED_MINUTES, SLOWEST_FULL_RUN_MINUTES, SLOWEST_FULL_RUN_MINUTES),
  ).toBeLessThanOrEqual(minutesOf(LIVE_BY));
  expect(releaseWorkflow).toContain(`run: bash .github/scripts/hold-until.sh ${RELEASE_DECIDES}`);
});

test('a run that starts in the night holds exactly until 03:30 Berlin', () => {
  expect(secondsHeldFrom('2026-11-10T01:00:00Z')).toBe(1.5 * HOUR);
  // GitHub's worst delay on this line, 10 hours after 17:00, still arrives before 03:30.
  expect(secondsHeldFrom('2026-11-10T02:00:00Z')).toBe(0.5 * HOUR);
});

test('03:30 stays 03:30 Berlin across both clock changes', () => {
  // Winter 02:30 UTC, summer 01:30 UTC.
  expect(secondsHeldFrom('2026-07-01T00:00:00Z')).toBe(1.5 * HOUR);
  // From 19:00 Berlin, the night of 2027-03-28 lasts an hour less, the night of 2026-10-25 an hour more.
  // Both are Saturday nights, which hold no release (Sunday to Thursday evenings).
  expect(secondsHeldFrom('2027-03-27T18:00:00Z')).toBe(LEG);
  expect(secondsHeldFrom(new Date(Date.parse('2027-03-27T18:00:00Z') + LEG * 1000).toISOString())).toBe(
    7.5 * HOUR - LEG,
  );
  expect(secondsHeldFrom('2026-10-25T00:00:00Z')).toBe(2.5 * HOUR);
  expect(secondsHeldFrom('2026-10-24T17:00:00Z')).toBe(LEG);
  expect(secondsHeldFrom(new Date(Date.parse('2026-10-24T17:00:00Z') + LEG * 1000).toISOString())).toBe(
    9.5 * HOUR - LEG,
  );
});

test('a run GitHub starts on time holds through both legs and no further', () => {
  // 17:00 Berlin: 10.5 hours to 03:30, more than one leg may last.
  const start = Date.parse('2026-11-09T16:00:00Z');
  expect(secondsHeldFrom('2026-11-09T16:00:00Z')).toBe(LEG);
  const second = new Date(start + LEG * 1000).toISOString();
  expect(secondsHeldFrom(second)).toBe(10.5 * HOUR - LEG);
  expect(secondsHeldFrom('2026-11-10T02:30:00Z')).toBe(0);
});

test('a run that arrives after 03:30 goes on at once instead of waiting a day', () => {
  expect(secondsHeldFrom('2026-11-10T02:31:00Z')).toBe(0);
  expect(secondsHeldFrom('2026-11-10T13:40:00Z')).toBe(0);
});

test('the release waits for its hold, and only a schedule event holds', () => {
  expect(releaseWorkflow).toMatch(/\n {2}candidate:\n {4}name: .+\n {4}needs: hold\n/);
  const holdSteps = releaseWorkflow.slice(
    releaseWorkflow.indexOf('\n  hold:'),
    releaseWorkflow.indexOf('\n  candidate:'),
  );
  expect(holdSteps.match(/- uses:|- name:/g)).toHaveLength(2);
  expect(holdSteps.match(/if: github\.event_name == 'schedule'/g)).toHaveLength(2);
  // A skipped job would skip the gate jobs behind it, so the job itself always runs.
  expect(holdSteps).not.toMatch(/\n {4}if:/);
  expect(releaseWorkflow).toContain("github.event_name == 'schedule' && 'scheduled'");
  expect(releaseWorkflow).toContain('needs: [hold, candidate, full, release, smoke, proof]');
});

test('the nightly shares the release cron line, so the release usually reuses its run', () => {
  const cronLine = (workflow: string) => /- cron: '(\d+ \d+) /.exec(workflow)?.[1];
  expect(cronLine(nightlyWorkflow)).toBe(cronLine(releaseWorkflow));
  expect(nightlyWorkflow).toMatch(/- cron: '\d+ \d+ \* \* \*'\n {6}timezone: Europe\/Berlin/);
});

test('a held run whose commit production already passed ends quietly with nothing to do', () => {
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
  // The decision needs no full run here: a gh call would fail the run.
  writeFileSync(join(stub, 'gh'), '#!/usr/bin/env bash\nexit 1\n');
  chmodSync(join(stub, 'gh'), 0o755);
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
