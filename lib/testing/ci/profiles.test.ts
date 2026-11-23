// Each CI profile places every inventory item on a clock that fires it, the fleet's values are
// #582's own, the local profile's are marked placeholders, each gap of the queue-wait check is
// named per kind of executor, and only ci/profile.json on the fetched main picks the active one
// (lib/testing/ci/profiles.ts).
import { afterEach, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BERLIN_TIME_ZONE } from '../../date-time/berlin';
import { z } from '../../zod';
import { readWorkflow, workflowsFolder } from '../ci-workflow';
import { CI_EVENTS, CI_JOBS } from './dag';
import { FULL_RUN_SLOTS } from './full-run';
import { INVENTORY_KEYS, SCHEDULE_NAMES, type ScheduleTrigger, SCHEDULES } from './inventory';
import { MIRROR_JOB_CAP } from './mirror';
import {
  CI_PROFILE_NAMES,
  CI_PROFILES,
  type CiProfile,
  placementOf,
  profileOnMainIn,
  QUEUE_WAIT_OBSERVES,
  type Timing,
} from './profiles';
import { MAX_BATCH } from './queue';
import { CLOCK_WORK, type ClockWorkName, releaseOnCron, scheduleDue } from './schedule';

const repositoryRoot = resolve(import.meta.dir, '../../..');
const WALL_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

test('each profile places every inventory item and nothing else', () => {
  for (const name of CI_PROFILE_NAMES) {
    const profile = CI_PROFILES[name];
    expect(profile.name).toBe(name);
    expect(Object.keys(profile.jobs).toSorted()).toEqual([...CI_JOBS].sort());
    expect(Object.keys(profile.runs).toSorted()).toEqual([...CI_EVENTS].sort());
    expect(Object.keys(profile.schedules).toSorted()).toEqual([...SCHEDULE_NAMES].sort());
    for (const key of INVENTORY_KEYS) {
      const { atOnce } = placementOf(profile, key);
      expect(atOnce === 'all' || (Number.isInteger(atOnce) && atOnce > 0), `${name} ${key}`).toBe(true);
    }
  }
});

test('a timed schedule gets a time in every profile, an event schedule none', () => {
  const timings: Timing[] = [];
  for (const profile of Object.values(CI_PROFILES))
    for (const name of SCHEDULE_NAMES) {
      const placement = profile.schedules[name];
      const timed = SCHEDULES[name].trigger.on === 'time';
      expect('timing' in placement, `${profile.name} ${name}`).toBe(timed);
      if ('timing' in placement) timings.push(placement.timing);
    }
  for (const timing of timings) {
    if (timing.kind === 'clock') {
      expect(timing.at).toMatch(WALL_TIME);
      expect(timing.weekdays.length).toBeGreaterThan(0);
    } else {
      expect([timing.from, timing.to]).toEqual([
        expect.stringMatching(WALL_TIME),
        expect.stringMatching(WALL_TIME),
      ]);
      expect(timing.from < timing.to && timing.everyMinutes > 0).toBe(true);
    }
  }
});

/** The timing a cron line of GitHub fires at: `M H * * D`, D Sunday 0, a list, a range or `*`. */
const timingOfCron = (cron: string, timezone: string | undefined) => {
  const [minute = '', hour = '', day = '', month = '', weekdays = ''] = cron.split(' ');
  if (day !== '*' || month !== '*') throw new Error(`${cron} is no daily or weekly cron line.`);
  const sundayFirst =
    weekdays === '*'
      ? [0, 1, 2, 3, 4, 5, 6]
      : weekdays.split(',').flatMap((part) => {
          const [from = 0, to = from] = part.split('-').map(Number);
          return Array.from({ length: to - from + 1 }, (_, offset) => from + offset);
        });
  const mondayFirst = sundayFirst.map((weekday) => (weekday + 6) % 7).toSorted((a, b) => a - b);
  return {
    kind: 'clock' as const,
    at: `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`,
    zone: timezone === BERLIN_TIME_ZONE ? BERLIN_TIME_ZONE : 'UTC',
    weekdays: mondayFirst,
  };
};

/** The timing of each of the conductor's clocks: CLOCK_WORK and the full-run slots. */
const CONDUCTOR_TIMINGS: Readonly<Record<ClockWorkName | 'full-run', Timing>> = {
  release: {
    kind: 'clock',
    at: CLOCK_WORK.release.time,
    zone: BERLIN_TIME_ZONE,
    weekdays: CLOCK_WORK.release.weekdays,
  },
  nightly: {
    kind: 'clock',
    at: CLOCK_WORK.nightly.time,
    zone: BERLIN_TIME_ZONE,
    weekdays: CLOCK_WORK.nightly.weekdays,
  },
  'full-run': {
    kind: 'slots',
    from: FULL_RUN_SLOTS.first,
    to: FULL_RUN_SLOTS.last,
    everyMinutes: FULL_RUN_SLOTS.intervalMs / 60_000,
  },
};

test("each timed schedule fires at the time of the clock its profile names: the workflow's cron or the conductor's", () => {
  for (const profile of Object.values(CI_PROFILES))
    for (const name of SCHEDULE_NAMES) {
      const trigger: ScheduleTrigger = SCHEDULES[name].trigger;
      const placement = profile.schedules[name];
      if (trigger.on !== 'time' || !('timing' in placement)) continue;
      const where = `${profile.name} ${name} on the ${placement.clock} clock`;
      if (placement.clock === 'planned') {
        // No code fires a planned clock: only a profile whose values wait for measurements has one.
        expect(profile.values, where).toBe('placeholder');
        continue;
      }
      const clock =
        placement.clock === 'workflow'
          ? trigger.workflow && timingOfCron(trigger.workflow.cron, trigger.workflow.timezone)
          : trigger.conductor && CONDUCTOR_TIMINGS[trigger.conductor];
      if (!clock) throw new Error(`${where}: the item has no such clock.`);
      // The cron's timing is plain data, so both sides compare as unknown.
      expect<unknown>(placement.timing, where).toEqual(clock);
    }
});

test("the fleet profile is #582's design: the mirror's cap, batches of 4, and every schedule on a clock that fires it", () => {
  const fleet = CI_PROFILES.fleet;
  expect(fleet.values).toBe('in use');
  expect(fleet.window).toBeUndefined();
  expect(fleet.jobsAtOnce).toBe(MIRROR_JOB_CAP);
  expect(fleet.maxBatch).toBe(MAX_BATCH);
  expect(fleet.jobs.browser.atOnce).toBe('all');
  // The conductor fires the work it has a clock for, release.yml's cron the release while it has
  // one, and nightly.yml alone lists the quarantines.
  expect(fleet.schedules.nightly.clock).toBe('conductor');
  expect(fleet.schedules['release-candidate'].clock).toBe('workflow');
  expect(fleet.schedules['main-full-run'].clock).toBe('conductor');
  expect(fleet.schedules['nightly-quarantine'].clock).toBe('workflow');
  expect(readWorkflow('date-lookahead.yml').at('jobs', 'leg', 'strategy', 'max-parallel')).toBe(
    fleet.schedules['date-lookahead'].atOnce,
  );
});

// scheduleDue dispatches the release only while release.yml has no cron, so a profile that names
// the conductor beside a cron claims a dispatch nobody makes, and the run waits in the hold instead.
test("each profile names the release's active dispatcher: release.yml's cron while it has one, the conductor only without", () => {
  const release = SCHEDULES['release-candidate'].trigger;
  const onCron = releaseOnCron(
    Bun.YAML.parse(readFileSync(join(repositoryRoot, workflowsFolder(), 'release.yml'), 'utf8')),
  );
  if (typeof onCron !== 'boolean') throw new Error(onCron.unreadable);
  // Monday 03:30 Berlin, the release's slot: the conductor dispatches it now or never.
  const answer = scheduleDue({
    now: new Date('2026-11-23T02:30:00Z'),
    state: {},
    fullRun: () => ({ run: false, reason: 'main has its full run.' }),
    releaseOnCron: onCron,
    fullRunning: false,
    held: [],
    prRuns: [],
    remoteHead: () => undefined,
  });
  const conductorDispatches = answer.start.some((start) => start.work === 'release');
  expect(conductorDispatches).toBe(!onCron);
  const active = conductorDispatches ? 'conductor' : 'workflow';
  for (const profile of Object.values(CI_PROFILES))
    expect(profile.schedules['release-candidate'].clock, profile.name).toBe(active);
  if (active === 'workflow') {
    // The cron dispatches at its own time; the hold, not the dispatch, waits for the decision.
    expect<string>(release.workflow.cron).toBe(
      z.string().parse(readWorkflow('release.yml').at('on', 'schedule', 0, 'cron')),
    );
    expect<string>(release.hold.until).toBe(CLOCK_WORK.release.time);
  }
});

/** The schedules whose placement in `profile` carries a gap, as `schedule:<name>`. */
const gapsOf = (profile: CiProfile): string[] =>
  SCHEDULE_NAMES.filter((name) => profile.schedules[name].gaps !== undefined).map(
    (name) => `schedule:${name}`,
  );

test('the queue-wait check observes only the Actions jobs of ci.yml here, so each profile names a gap for every other kind it runs on', () => {
  const script = readFileSync(join(repositoryRoot, '.github/scripts/ci-queue.sh'), 'utf8');
  // Only this repository's ci.yml runs: not the CI mirror's repository, nor any machine off GitHub.
  expect(script).toContain('repos/${GITHUB_REPOSITORY}/actions/workflows/ci.yml/runs');
  expect(readWorkflow('health.yml').text('jobs', 'ci-queue', 'steps', 1, 'run')).toContain(
    'bash .github/scripts/ci-queue.sh',
  );
  expect(QUEUE_WAIT_OBSERVES).toEqual(['actions']);
  for (const profile of Object.values(CI_PROFILES)) {
    const unobserved = profile.runsOn.filter((kind) => !QUEUE_WAIT_OBSERVES.includes(kind));
    const gaps = profile.schedules['health-ci-queue'].gaps ?? {};
    expect(Object.keys(gaps).toSorted(), profile.name).toEqual(unobserved.toSorted());
    for (const text of Object.values(gaps)) expect(text, profile.name).toStartWith('Not yet measured: ');
    // A gap is allowed only where it is named: the queue-wait check's.
    expect(gapsOf(profile), profile.name).toEqual(unobserved.length ? ['schedule:health-ci-queue'] : []);
  }
  // The fleet's check covers only its Actions-run jobs; the mirror's and Boat's waits are not yet measured.
  expect(CI_PROFILES.fleet.runsOn).toEqual(['actions', 'mirror', 'boat']);
  expect(Object.keys(CI_PROFILES.fleet.schedules['health-ci-queue'].gaps ?? {})).toEqual(['mirror', 'boat']);
  expect(Object.keys(CI_PROFILES.local.schedules['health-ci-queue'].gaps ?? {})).toEqual(['local']);
});

test('the local profile is marked a placeholder: one unit at a time, at most two jobs at once', () => {
  const local = CI_PROFILES.local;
  expect(local.values).toBe('placeholder');
  expect(local.jobsAtOnce).toBeLessThanOrEqual(2);
  expect(local.maxBatch).toBeLessThanOrEqual(MAX_BATCH);
  expect(local.window).toBeDefined();
  for (const key of INVENTORY_KEYS)
    expect(placementOf(local, key), key).toEqual({
      executor: 'local',
      atOnce: key.startsWith('run:') ? local.jobsAtOnce : 1,
    });
});

/** A clone whose fetched main holds `text` as ci/profile.json, or no switch at all. */
const cloneWithMain = (text: string | undefined): string => {
  const folder = mkdtempSync(join(tmpdir(), 'ci-profile-'));
  folders.push(folder);
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=ci', '-c', 'user.email=ci@example.invalid', '-c', 'commit.gpgSign=false', ...args],
      { cwd: folder, encoding: 'utf8' },
    );
  git('init', '--quiet', '--initial-branch=main');
  mkdirSync(join(folder, 'ci'));
  writeFileSync(join(folder, 'README.md'), 'clone\n');
  if (text !== undefined) writeFileSync(join(folder, 'ci', 'profile.json'), text);
  git('add', '.');
  git('commit', '--quiet', '-m', 'main');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  return folder;
};

test.each(CI_PROFILE_NAMES.map((name) => [name]))('a switch on main that names %s picks it', (name) => {
  expect(profileOnMainIn(cloneWithMain(JSON.stringify({ profile: name }))).profile.name).toBe(name);
});

test('the checked-in switch names a valid profile', () => {
  const checkedIn = readFileSync(join(repositoryRoot, 'ci', 'profile.json'), 'utf8');
  expect(CI_PROFILE_NAMES).toContain(profileOnMainIn(cloneWithMain(checkedIn)).profile.name);
});

test("the switch is main's, not the checkout's: a switch only in the working tree throws", () => {
  const clone = cloneWithMain(undefined);
  writeFileSync(join(clone, 'ci', 'profile.json'), '{"profile":"fleet"}');
  expect(() => profileOnMainIn(clone)).toThrow();
});

test('a missing, unknown or widened switch throws, so no conductor guesses its profile', () => {
  const bare = mkdtempSync(join(tmpdir(), 'ci-profile-'));
  folders.push(bare);
  expect(() => profileOnMainIn(bare)).toThrow();
  for (const text of [
    '{"profile":"boat"}',
    '{"profile":"local","jobsAtOnce":8}',
    '{"profile":"mac"}',
    '{}',
    'local',
  ])
    expect(() => profileOnMainIn(cloneWithMain(text)), text).toThrow();
});
