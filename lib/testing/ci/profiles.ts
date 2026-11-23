// The two CI profiles and the one switch between them (decision 0011, docs/decisions/0011-ci-profiles.md).
// A profile places every item of the inventory (inventory.ts): which machine runs it, how many of
// its units at once, how a queue batches, and when a schedule fires. It never says what a run
// tests: that stays the DAG's (dag.ts) and the planner's (ci-plan.ts), the same in both profiles.
// ci/profile.json on main names the active profile, and only `activeProfile` reads it, from the
// main this clone fetched last (lib/conventions/ci-profile-switch.test.ts).
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { BERLIN_TIME_ZONE } from '../../date-time/berlin';
import { z } from '../../zod';
import { CI_EVENTS, CI_JOBS, type CiEvent, type CiJob } from './dag';
import { FULL_RUN_SLOTS } from './full-run';
import { type EventSchedule, type InventoryKey, SCHEDULE_NAMES, type TimedSchedule } from './inventory';
import { MIRROR_JOB_CAP } from './mirror';
import { MAX_BATCH } from './queue';
import { CLOCK_WORK } from './schedule';

export const CI_PROFILE_NAMES = ['fleet', 'local'] as const;
export type CiProfileName = (typeof CI_PROFILE_NAMES)[number];

/**
 * - `conductor`: the host that plans, checks, queues and schedules (scripts/ci/run-commit.ts,
 *   queue.ts, schedule.ts).
 * - `fleet`: one of many machines: a GitHub Actions runner, directly or through the CI mirror, or
 *   a Boat machine.
 * - `local`: one of the owner's machines, the MacBook or the PC (a WSL distro); a pull request's
 *   run goes start to finish on the one that claims it.
 */
type Executor = 'conductor' | 'fleet' | 'local';

/**
 * Where a profile's jobs run, as finely as the queue-wait check tells them apart: GitHub Actions
 * jobs of this repository's ci.yml (`actions`), jobs of the CI mirror's own repository on GitHub
 * (`mirror`), a Boat machine (`boat`), or one of the owner's machines (`local`).
 */
type ExecutorKind = 'actions' | 'mirror' | 'boat' | 'local';
/**
 * The kinds whose queue wait .github/scripts/ci-queue.sh observes: it reads the runs of ci.yml in
 * the repository health.yml runs in, this one, so only the jobs GitHub Actions runs there.
 */
export const QUEUE_WAIT_OBSERVES: readonly ExecutorKind[] = ['actions'];

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
type Placement = {
  executor: Executor;
  atOnce: AtOnce;
  /**
   * What this placement does not yet cover, per kind of executor, for the owner to see: set where
   * the item's source cannot check that kind's work yet. profiles.test.ts allows a gap only where it
   * names one: the queue-wait check's, for each kind of `runsOn` it does not observe.
   */
  gaps?: Readonly<Partial<Record<ExecutorKind, string>>>;
};

/**
 * The dispatcher that fires a timed schedule, one of the clocks its inventory item records (inventory.ts):
 * - `workflow`: the `on.schedule` cron of the item's workflow, on GitHub.
 * - `conductor`: the conductor's clock, `CLOCK_WORK` (schedule.ts) or the full-run slots.
 * - `planned`: a clock no code fires yet; only a placeholder profile may plan one.
 * profiles.test.ts holds `timing` to that clock's own time, and the release's to the dispatcher
 * `scheduleDue` leaves active.
 */
type Clock = 'workflow' | 'conductor' | 'planned';
type TimedPlacement = Placement & { clock: Clock; timing: Timing };

export type CiProfile = {
  name: CiProfileName;
  /** The machines the profile stands for. */
  machines: string;
  /** The kinds of executor its jobs run on. */
  runsOn: readonly ExecutorKind[];
  /** `placeholder` until its values are measured (werk-flow/werkflow-planning#503, P3). */
  values: 'in use' | 'placeholder';
  /** The most jobs one conductor runs at once, every run together: CI_PARALLEL's default. */
  jobsAtOnce: number;
  /** The most pull requests in one queue batch: scripts/ci/queue.ts --max-batch's default. */
  maxBatch: number;
  /**
   * The Berlin hours its scheduled work starts in, or undefined for any hour. A cron that only
   * dispatches a hold (release.yml at 17:00) starts its work when the hold ends, which is what counts.
   */
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
/** release.yml's cron, Sunday to Thursday 17:00 Berlin: the evening before each weekday's release. */
const releaseDispatch: Timing = {
  kind: 'clock',
  at: '17:00',
  zone: BERLIN_TIME_ZONE,
  weekdays: [0, 1, 2, 3, 6],
};
const healthWeekly: Timing = { kind: 'clock', at: '05:00', zone: 'UTC', weekdays: [0] };

/**
 * The queue-wait check covers only Actions-run jobs: it reads the waits of this repository's ci.yml
 * jobs on GitHub (.github/scripts/ci-queue.sh) and passes when it finds none, so it says nothing of
 * another kind's queue.
 */
const QUEUE_WAIT_GAPS = {
  mirror:
    "Not yet measured: the queue-wait check covers only Actions-run jobs of this repository's ci.yml, and a job the CI mirror runs is a run of the mirror's own repository (werk-flow/werkflow-planning#503).",
  boat: 'Not yet measured: the queue-wait check covers only Actions-run jobs of ci.yml, and a Boat machine leaves no Actions job for it to read (werk-flow/werkflow-planning#503).',
  local:
    "Not yet measured: the local machines' queue wait has no evidence until a local executor records each job's wait and the check reads it (werk-flow/werkflow-planning#503, P3).",
} as const satisfies Readonly<Partial<Record<ExecutorKind, string>>>;

/** #582's design: a conductor, the CI mirror's machines, GitHub's workflows for the rest. */
const FLEET: CiProfile = {
  name: 'fleet',
  machines: 'Boat or GitHub Actions: many machines and a conductor',
  runsOn: ['actions', 'mirror', 'boat'],
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
    nightly: { executor: 'conductor', atOnce: 'all', clock: 'conductor', timing: nightly },
    // The conductor's nightly lists no quarantines: only nightly.yml's own cron runs the list.
    'nightly-quarantine': {
      executor: 'fleet',
      atOnce: 1,
      clock: 'workflow',
      timing: { kind: 'clock', at: '17:00', zone: BERLIN_TIME_ZONE, weekdays: EVERY_DAY },
    },
    'main-full-run': {
      executor: 'conductor',
      atOnce: 'all',
      clock: 'conductor',
      timing: {
        kind: 'slots',
        from: FULL_RUN_SLOTS.first,
        to: FULL_RUN_SLOTS.last,
        everyMinutes: FULL_RUN_SLOTS.intervalMs / 60_000,
      },
    },
    // date-lookahead.yml's max-parallel (profiles.test.ts reads it).
    'date-lookahead': {
      executor: 'fleet',
      atOnce: 7,
      clock: 'workflow',
      timing: { kind: 'clock', at: '05:15', zone: 'UTC', weekdays: EVERY_DAY },
    },
    // The queue-wait check covers only Actions-run jobs: those of ci.yml in this repository.
    'health-ci-queue': {
      executor: 'fleet',
      atOnce: 1,
      clock: 'workflow',
      timing: healthWeekly,
      gaps: { mirror: QUEUE_WAIT_GAPS.mirror, boat: QUEUE_WAIT_GAPS.boat },
    },
    'health-pr-asset-branches': { executor: 'fleet', atOnce: 1, clock: 'workflow', timing: healthWeekly },
    // release.yml's cron dispatches it while it has one; its hold waits for 03:30 (inventory.ts).
    'release-candidate': { executor: 'fleet', atOnce: 'all', clock: 'workflow', timing: releaseDispatch },
    'list-growth': { executor: 'fleet', atOnce: 1 },
    'pr-screenshots': { executor: 'fleet', atOnce: 1 },
    'main-green-notice': { executor: 'fleet', atOnce: 1 },
    'merge-queue-notice': { executor: 'fleet', atOnce: 1 },
  },
};

/**
 * The owner's MacBook and PC: every unit in turn, at most two jobs at once, heavy schedules in a
 * night window.
 * PLACEHOLDER: every value below waits for the measurements of P3 (werk-flow/werkflow-planning#503).
 * `jobsAtOnce` and `maxBatch` keep the defaults the scripts had before the profiles.
 */
const LOCAL: CiProfile = {
  name: 'local',
  machines: "The owner's MacBook and PC",
  runsOn: ['local'],
  values: 'placeholder',
  jobsAtOnce: 2,
  maxBatch: MAX_BATCH,
  window: { from: '22:00', to: '06:00' },
  jobs: {
    plan: { executor: 'local', atOnce: 1 },
    fast: { executor: 'local', atOnce: 1 },
    sql: { executor: 'local', atOnce: 1 },
    components: { executor: 'local', atOnce: 1 },
    invoices: { executor: 'local', atOnce: 1 },
    midnight: { executor: 'local', atOnce: 1 },
    browser: { executor: 'local', atOnce: 1 },
    check: { executor: 'local', atOnce: 1 },
  },
  runs: {
    pr: { startedBy: 'local' },
    integration: { startedBy: 'local' },
    main: { startedBy: 'local' },
    full: { startedBy: 'local' },
  },
  schedules: {
    'main-full-run': {
      executor: 'local',
      atOnce: 1,
      clock: 'planned',
      timing: { kind: 'slots', from: '22:00', to: '23:30', everyMinutes: 180 },
    },
    nightly: { executor: 'local', atOnce: 1, clock: 'conductor', timing: nightly },
    'nightly-quarantine': { executor: 'local', atOnce: 1, clock: 'planned', timing: nightly },
    'date-lookahead': {
      executor: 'local',
      atOnce: 1,
      clock: 'planned',
      timing: { kind: 'clock', at: '01:30', zone: BERLIN_TIME_ZONE, weekdays: EVERY_DAY },
    },
    'release-candidate': { executor: 'local', atOnce: 1, clock: 'workflow', timing: releaseDispatch },
    'health-ci-queue': {
      executor: 'local',
      atOnce: 1,
      clock: 'planned',
      timing: { kind: 'clock', at: '05:00', zone: BERLIN_TIME_ZONE, weekdays: [0] },
      gaps: { local: QUEUE_WAIT_GAPS.local },
    },
    'health-pr-asset-branches': {
      executor: 'local',
      atOnce: 1,
      clock: 'planned',
      timing: { kind: 'clock', at: '05:00', zone: BERLIN_TIME_ZONE, weekdays: [0] },
    },
    'list-growth': { executor: 'local', atOnce: 1 },
    'pr-screenshots': { executor: 'local', atOnce: 1 },
    'main-green-notice': { executor: 'local', atOnce: 1 },
    'merge-queue-notice': { executor: 'local', atOnce: 1 },
  },
};

/** Both profiles by name. Code picks one only through `activeProfile`; tests read both. */
export const CI_PROFILES: Readonly<Record<CiProfileName, CiProfile>> = { fleet: FLEET, local: LOCAL };

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
/** GitHub's main as this clone fetched it last: the snapshot run-commit and the queue orchestrate from. */
const FETCHED_MAIN = 'refs/remotes/origin/main';
/**
 * The refspec that fetches main whatever the clone's own fetch refspec maps: a single-branch clone
 * of another branch would otherwise fetch fine and keep a stale or missing `origin/main`.
 */
export const MAIN_REFSPEC = `+refs/heads/main:${FETCHED_MAIN}`;
/** The trusted clone the conductor's scripts run from (scripts/ci/run.ts `repository`). */
const OWN_CLONE = resolve(import.meta.dir, '../../..');

/** A profile with the commit of main whose switch named it: one snapshot of main for every reader. */
export type ActiveProfile = { profile: CiProfile; main: string };

/**
 * The profile `ci/profile.json` on this clone's fetched main names: the one way code picks a
 * profile. Fetch `MAIN_REFSPEC` first, as run-commit and the queue do, so every clone that
 * orchestrates reads main's answer, not its own checkout's. It reads the switch at one commit and
 * returns that commit, so a caller that also acts on main can hold both to the same snapshot. A
 * switch main lacks or names wrong throws, so a conductor never guesses its profile.
 */
export function activeProfile(): ActiveProfile {
  return profileOnMainIn(OWN_CLONE);
}

/**
 * `activeProfile` of another clone, for tests that build one. Only test files may call it
 * (lib/conventions/ci-profile-switch.test.ts): production code reads its own clone's main.
 */
export function profileOnMainIn(clone: string): ActiveProfile {
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: clone, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const main = git('rev-parse', '--verify', '--quiet', `${FETCHED_MAIN}^{commit}`).trim();
  const text = git('show', `${main}:${PROFILE_FILE}`);
  return { profile: CI_PROFILES[profileFileSchema.parse(JSON.parse(text)).profile], main };
}
