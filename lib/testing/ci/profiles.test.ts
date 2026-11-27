// Each CI profile places every inventory item on a clock that fires it, the fleet's values are
// #582's own, the local profile's are marked placeholders, each gap of the queue-wait check is
// named per kind of executor, and only ci/profile.json on the fetched main picks the active one
// (lib/testing/ci/profiles.ts).
import { afterEach, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

test('a timed schedule gets a time in every profile unless only a dispatch starts it, an event schedule none', () => {
  const timings: Timing[] = [];
  for (const profile of Object.values(CI_PROFILES))
    for (const name of SCHEDULE_NAMES) {
      const placement = profile.schedules[name];
      const dispatched = 'clock' in placement && placement.clock === 'dispatch';
      const timed = SCHEDULES[name].trigger.on === 'time' && !dispatched;
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

/** The workflows an inventory item's sources name, as `<file>.yml`. */
const workflowsOf = (name: (typeof SCHEDULE_NAMES)[number]): string[] => [
  ...new Set(
    SCHEDULES[name].sources.flatMap((source) => {
      const workflow = /^([\w-]+\.yml)#/.exec(source)?.[1];
      return workflow ? [workflow] : [];
    }),
  ),
];

/** A workflow's `on:` triggers, keyed by event. */
const onOf = (workflow: string): Record<string, unknown> =>
  z.record(z.string(), z.unknown()).parse(readWorkflow(workflow).at('on'));

/** The `full` input of each job of a workflow that calls ci.yml, or '' where a call passes none. */
const ciCalls = (workflow: string): string[] =>
  Object.values(z.record(z.string(), z.unknown()).parse(readWorkflow(workflow).at('jobs'))).flatMap((job) => {
    const call = z
      .object({
        uses: z.literal('./.github/workflows/ci.yml'),
        with: z.object({ full: z.string() }).partial().optional(),
      })
      .safeParse(job);
    return call.success ? [call.data.with?.full ?? ''] : [];
  });

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
      if (trigger.on !== 'time' || !('clock' in placement)) continue;
      if (placement.clock === 'dispatch') {
        // No clock fires it: every workflow of the item starts only by workflow_dispatch.
        expect(trigger.workflow, `${profile.name} ${name}`).toBeUndefined();
        expect(placement.dispatchedBy.length, `${profile.name} ${name}`).toBeGreaterThan(0);
        for (const workflow of workflowsOf(name))
          expect(Object.keys(onOf(workflow)), `${profile.name} ${name}: ${workflow}`).toEqual([
            'workflow_dispatch',
          ]);
        continue;
      }
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

/**
 * The run kind ci.yml's own triggers start, as its `CI_EVENT` expression picks it: a pull request,
 * a merge group, a push to main, and the midnight proof's dispatch, which selects the full tier.
 * `workflow_call` is no start of its own: the calling workflow's trigger is.
 */
const CI_TRIGGER_KINDS = {
  pull_request: 'pr',
  merge_group: 'integration',
  push: 'main',
  workflow_dispatch: 'full',
} as const;

const ciTrigger = z.enum(['pull_request', 'merge_group', 'push', 'workflow_dispatch']);

test("every trigger of ci.yml and of each workflow that calls it starts the fleet's run of the kind it runs", () => {
  const expression = readWorkflow('ci.yml').text('env', 'CI_EVENT');
  expect(expression).toContain("inputs.midnight_proof_minutes) && 'full'");
  expect(expression).toContain("github.event_name == 'pull_request' && 'pr'");
  expect(expression).toContain("github.event_name == 'merge_group' && 'integration'");
  expect(expression).toEndWith("|| 'main' }}");
  const expected: string[] = [];
  for (const file of readdirSync(join(repositoryRoot, workflowsFolder())).filter((name) =>
    name.endsWith('.yml'),
  )) {
    const calls = ciCalls(file);
    if (file !== 'ci.yml' && calls.length === 0) continue;
    // A caller passes `full`, so each of its runs is a full run.
    for (const full of calls) expect(full, file).not.toBe('');
    for (const on of Object.keys(onOf(file))) {
      if (file === 'ci.yml' && on === 'workflow_call') continue;
      // A trigger ci.yml gains without a kind here fails the parse.
      const kind = file === 'ci.yml' ? CI_TRIGGER_KINDS[ciTrigger.parse(on)] : 'full';
      expected.push(`${kind} ${file}#${on}`);
    }
  }
  const placed = CI_EVENTS.flatMap((event) => {
    const start = CI_PROFILES.fleet.runs[event];
    if (start.startedBy !== 'fleet') throw new Error(`fleet's ${event} run starts off GitHub Actions.`);
    return start.on.map((trigger) => `${event} ${trigger}`);
  });
  expect(placed.toSorted()).toEqual(expected.toSorted());
});

test("the fleet profile is #582's design: the mirror's cap, batches of 4, and every schedule on a clock that fires it", () => {
  const fleet = CI_PROFILES.fleet;
  expect(fleet.values).toBe('in use');
  expect(fleet.window).toBeUndefined();
  expect(fleet.jobsAtOnce).toBe(MIRROR_JOB_CAP);
  expect(fleet.maxBatch).toBe(MAX_BATCH);
  expect(fleet.jobs.browser.atOnce).toBe('all');
  // On GitHub Actions no conductor's clock fires anything: nightly.yml's cron runs the nightly and
  // its quarantine list, and the release and main's full run wait for a dispatch.
  expect(fleet.schedules.nightly.clock).toBe('workflow');
  expect(fleet.schedules['release-candidate'].clock).toBe('dispatch');
  expect(fleet.schedules['main-full-run'].clock).toBe('dispatch');
  expect(fleet.schedules['nightly-quarantine'].clock).toBe('workflow');
  expect(readWorkflow('date-lookahead.yml').at('jobs', 'leg', 'strategy', 'max-parallel')).toBe(
    fleet.schedules['date-lookahead'].atOnce,
  );
});

// GitHub starts a scheduled run hours late, so release.yml has no cron, and no runner holds a run
// until 03:30 (werk-flow/werkflow-planning#503). A dispatch at the release clock starts it instead.
test('the release waits for a dispatch at 03:30 on weekdays: the ci-alert timer on GitHub Actions, the conductor in the local profile', () => {
  const onCron = releaseOnCron(
    Bun.YAML.parse(readFileSync(join(repositoryRoot, workflowsFolder(), 'release.yml'), 'utf8')),
  );
  expect(onCron).toBe(false);
  expect(CLOCK_WORK.release).toMatchObject({ time: '03:30', weekdays: [0, 1, 2, 3, 4] });
  const fleet = CI_PROFILES.fleet.schedules['release-candidate'];
  if (!('dispatchedBy' in fleet)) throw new Error("The fleet's release is not dispatched.");
  expect(fleet.dispatchedBy).toContain('Weekdays at 03:30 Berlin, ci-alert.timer');
  // Monday 03:30 Berlin, the release's slot: without a cron the conductor names it.
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
  expect(answer.start.some((start) => start.work === 'release')).toBe(true);
  expect(CI_PROFILES.local.schedules['release-candidate'].clock).toBe('conductor');
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
