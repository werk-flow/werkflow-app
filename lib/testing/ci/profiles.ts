// The two CI profiles and the one switch between them (decision 0011, docs/decisions/0011-ci-profiles.md).
// A profile places every item of the inventory (inventory.ts): which machine runs it, how many of
// its units at once, how a queue batches, and when a schedule fires. It never says what a run
// tests: that stays the DAG's (dag.ts) and the planner's (ci-plan.ts), the same in both profiles.
// ci/profile.json on main names the active profile, and only `activeProfile` reads it
// (lib/conventions/ci-profile-switch.test.ts).
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BERLIN_TIME_ZONE } from '../../date-time/berlin';
import { z } from '../../zod';
import { CI_EVENTS, CI_JOBS, type CiEvent, type CiJob } from './dag';
import { FULL_RUN_SLOTS } from './full-run';
import { type EventSchedule, type InventoryKey, SCHEDULE_NAMES, type TimedSchedule } from './inventory';
import { MIRROR_JOB_CAP } from './mirror';
import { MAX_BATCH } from './queue';
import { CLOCK_WORK } from './schedule';

export const CI_PROFILE_NAMES = ['fleet', 'mac'] as const;
export type CiProfileName = (typeof CI_PROFILE_NAMES)[number];

/**
 * - `conductor`: the host that plans, checks, queues and schedules (scripts/ci/run-commit.ts,
 *   queue.ts, schedule.ts).
 * - `fleet`: one of many machines: a GitHub Actions runner, directly or through the CI mirror, or
 *   a Boat machine.
 * - `mac`: the one MacBook.
 */
type Executor = 'conductor' | 'fleet' | 'mac';

/** Monday 0 to Sunday 6, as `getLocalWeekday` counts. */
type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
const EVERY_DAY: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6];

/**
 * When a timed schedule fires: at a wall time `HH:MM` on some weekdays, or in slots at most every
 * `everyMinutes` from `from` to `to` Berlin time, while its rule says work is due.
 */
export type Timing =
  | { kind: 'clock'; at: string; zone: typeof BERLIN_TIME_ZONE | 'UTC'; weekdays: readonly Weekday[] }
  | { kind: 'slots'; from: string; to: string; everyMinutes: number };

/** `all` runs every unit at once: each shard, leg or job of the item on its own machine. */
type AtOnce = number | 'all';
type Placement = { executor: Executor; atOnce: AtOnce };
type TimedPlacement = Placement & { timing: Timing };

export type CiProfile = {
  name: CiProfileName;
  /** The machines the profile stands for. */
  machines: string;
  /** `placeholder` until its values are measured (werk-flow/werkflow-planning#503, P3). */
  values: 'in use' | 'placeholder';
  /** The most jobs one conductor runs at once, every run together: CI_PARALLEL's default. */
  jobsAtOnce: number;
  /** The most pull requests in one queue batch: scripts/ci/queue.ts --max-batch's default. */
  maxBatch: number;
  /** The Berlin hours its timed schedules fire in, or undefined for any hour. */
  window: { from: string; to: string } | undefined;
  jobs: Readonly<Record<CiJob, Placement>>;
  /** Who starts each kind of run. */
  runs: Readonly<Record<CiEvent, { startedBy: Executor }>>;
  schedules: Readonly<Record<TimedSchedule, TimedPlacement> & Record<EventSchedule, Placement>>;
};

const nightly: Timing = {
  kind: 'clock',
  at: CLOCK_WORK.nightly.time,
  zone: BERLIN_TIME_ZONE,
  weekdays: CLOCK_WORK.nightly.weekdays,
};
const healthWeekly: Timing = { kind: 'clock', at: '05:00', zone: 'UTC', weekdays: [0] };

/** #582's design: a conductor, the CI mirror's machines, GitHub's workflows for the rest. */
const FLEET: CiProfile = {
  name: 'fleet',
  machines: 'Boat or GitHub Actions: many machines and a conductor',
  values: 'in use',
  jobsAtOnce: MIRROR_JOB_CAP,
  maxBatch: MAX_BATCH,
  window: undefined,
  jobs: {
    plan: { executor: 'conductor', atOnce: 1 },
    fast: { executor: 'fleet', atOnce: 'all' },
    sql: { executor: 'fleet', atOnce: 'all' },
    components: { executor: 'fleet', atOnce: 'all' },
    invoices: { executor: 'fleet', atOnce: 'all' },
    midnight: { executor: 'fleet', atOnce: 'all' },
    browser: { executor: 'fleet', atOnce: 'all' },
    check: { executor: 'conductor', atOnce: 1 },
  },
  runs: {
    pr: { startedBy: 'conductor' },
    integration: { startedBy: 'conductor' },
    main: { startedBy: 'conductor' },
    full: { startedBy: 'conductor' },
  },
  schedules: {
    nightly: { executor: 'conductor', atOnce: 'all', timing: nightly },
    'nightly-quarantine': { executor: 'fleet', atOnce: 1, timing: nightly },
    'main-full-run': {
      executor: 'conductor',
      atOnce: 'all',
      timing: {
        kind: 'slots',
        from: FULL_RUN_SLOTS.first,
        to: FULL_RUN_SLOTS.last,
        everyMinutes: FULL_RUN_SLOTS.intervalMs / 60_000,
      },
    },
    // date-lookahead.yml's cron and max-parallel (profiles.test.ts reads both).
    'date-lookahead': {
      executor: 'fleet',
      atOnce: 7,
      timing: { kind: 'clock', at: '05:15', zone: 'UTC', weekdays: EVERY_DAY },
    },
    'health-ci-queue': { executor: 'fleet', atOnce: 1, timing: healthWeekly },
    'health-pr-asset-branches': { executor: 'fleet', atOnce: 1, timing: healthWeekly },
    'release-candidate': {
      executor: 'conductor',
      atOnce: 'all',
      timing: {
        kind: 'clock',
        at: CLOCK_WORK.release.time,
        zone: BERLIN_TIME_ZONE,
        weekdays: CLOCK_WORK.release.weekdays,
      },
    },
    'list-growth': { executor: 'fleet', atOnce: 1 },
    'pr-screenshots': { executor: 'fleet', atOnce: 1 },
    'main-green-notice': { executor: 'fleet', atOnce: 1 },
    'merge-queue-notice': { executor: 'fleet', atOnce: 1 },
  },
};

/**
 * One MacBook: every unit in turn, at most two jobs at once, heavy schedules in a night window.
 * PLACEHOLDER: every value below waits for the measurements of P3 (werk-flow/werkflow-planning#503).
 * `jobsAtOnce` and `maxBatch` keep the defaults the scripts had before the profiles.
 */
const MAC: CiProfile = {
  name: 'mac',
  machines: 'One MacBook',
  values: 'placeholder',
  jobsAtOnce: 2,
  maxBatch: MAX_BATCH,
  window: { from: '22:00', to: '06:00' },
  jobs: {
    plan: { executor: 'mac', atOnce: 1 },
    fast: { executor: 'mac', atOnce: 1 },
    sql: { executor: 'mac', atOnce: 1 },
    components: { executor: 'mac', atOnce: 1 },
    invoices: { executor: 'mac', atOnce: 1 },
    midnight: { executor: 'mac', atOnce: 1 },
    browser: { executor: 'mac', atOnce: 1 },
    check: { executor: 'mac', atOnce: 1 },
  },
  runs: {
    pr: { startedBy: 'mac' },
    integration: { startedBy: 'mac' },
    main: { startedBy: 'mac' },
    full: { startedBy: 'mac' },
  },
  schedules: {
    'main-full-run': {
      executor: 'mac',
      atOnce: 1,
      timing: { kind: 'slots', from: '22:00', to: '23:30', everyMinutes: 180 },
    },
    nightly: { executor: 'mac', atOnce: 1, timing: nightly },
    'nightly-quarantine': { executor: 'mac', atOnce: 1, timing: nightly },
    'date-lookahead': {
      executor: 'mac',
      atOnce: 1,
      timing: { kind: 'clock', at: '01:30', zone: BERLIN_TIME_ZONE, weekdays: EVERY_DAY },
    },
    'release-candidate': {
      executor: 'mac',
      atOnce: 1,
      timing: {
        kind: 'clock',
        at: CLOCK_WORK.release.time,
        zone: BERLIN_TIME_ZONE,
        weekdays: CLOCK_WORK.release.weekdays,
      },
    },
    'health-ci-queue': {
      executor: 'mac',
      atOnce: 1,
      timing: { kind: 'clock', at: '05:00', zone: BERLIN_TIME_ZONE, weekdays: [0] },
    },
    'health-pr-asset-branches': {
      executor: 'mac',
      atOnce: 1,
      timing: { kind: 'clock', at: '05:00', zone: BERLIN_TIME_ZONE, weekdays: [0] },
    },
    'list-growth': { executor: 'mac', atOnce: 1 },
    'pr-screenshots': { executor: 'mac', atOnce: 1 },
    'main-green-notice': { executor: 'mac', atOnce: 1 },
    'merge-queue-notice': { executor: 'mac', atOnce: 1 },
  },
};

/** Both profiles by name. Code picks one only through `activeProfile`; tests read both. */
export const CI_PROFILES: Readonly<Record<CiProfileName, CiProfile>> = { fleet: FLEET, mac: MAC };

/** Where a profile places an inventory item: its machine, and the most of its units at once. */
export function placementOf(profile: CiProfile, key: InventoryKey): Placement {
  const job = CI_JOBS.find((candidate) => key === `job:${candidate}`);
  if (job) return profile.jobs[job];
  const event = CI_EVENTS.find((candidate) => key === `run:${candidate}`);
  // A run's units are its jobs.
  if (event) return { executor: profile.runs[event].startedBy, atOnce: profile.jobsAtOnce };
  const schedule = SCHEDULE_NAMES.find((candidate) => key === `schedule:${candidate}`);
  if (!schedule) throw new Error(`${key} is no inventory item.`);
  const { executor, atOnce } = profile.schedules[schedule];
  return { executor, atOnce };
}

/** The switch, a file of main, relative to the repository. */
const PROFILE_FILE = 'ci/profile.json';
const profileFileSchema = z.strictObject({ profile: z.enum(CI_PROFILE_NAMES) });

/**
 * The profile `ci/profile.json` of `repository` names: the one way code picks a profile. A missing
 * or malformed file throws, so a conductor never guesses its profile.
 */
export function activeProfile(repository = resolve(import.meta.dir, '../../..')): CiProfile {
  const text = readFileSync(join(repository, PROFILE_FILE), 'utf8');
  return CI_PROFILES[profileFileSchema.parse(JSON.parse(text)).profile];
}
