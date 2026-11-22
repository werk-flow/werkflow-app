// Everything CI must run, in one list (decision 0011, docs/decisions/0011-ci-profiles.md). Each CI
// profile (lib/testing/ci/profiles.ts) places every item of it; only where and when may differ.
// The jobs and run kinds come from the DAG (dag.ts), the group kinds from the test-group registry
// (lib/testing/selection/test-groups.ts), and the schedules from the conductor's rules
// (schedule.ts, full-run.ts) and the workflows that start them. inventory.test.ts keeps each
// schedule's sources in step with the workflows folder.
import type { TestGroup } from '../selection/test-groups';
import { CI_EVENTS, CI_JOBS, type CiEvent, type CiJob } from './dag';

/**
 * The job that runs each kind of test group: the fast tier's selection (fast-tier.ts) and the
 * browser plan (ci-plan.ts) fill these jobs. A kind CI never runs names why instead.
 */
export const GROUP_KIND_JOBS: Readonly<Record<TestGroup['kind'], CiJob | { outside: string }>> = {
  static: 'fast',
  unit: 'fast',
  sql: 'sql',
  ui: 'components',
  golden: 'browser',
  audit: 'browser',
  canary: {
    outside:
      'The cloud canary runs against DEV with its credentials, a local release check (docs/technical/testing.md, "CI").',
  },
};

/** What starts a schedule: a CI event such as a closed pull request, or a time the profile sets. */
type ScheduleTrigger = { on: 'event'; event: string } | { on: 'time' };

type ScheduleItem = {
  /** What it runs. */
  runs: string;
  /** The code and workflow jobs that define it, as `<file>` or `<file>#<job>`. */
  sources: readonly string[];
  trigger: ScheduleTrigger;
};

/**
 * Every schedule CI keeps besides the runs of a push, a queue batch or a pull request. The keyed
 * health checks, the release's PROD steps, the staging deploy and the production alert are no CI
 * work: `OUTSIDE_INVENTORY` names why.
 */
export const SCHEDULES = {
  nightly: {
    runs: 'A full run of main: every browser group, the wall-clock groups untimed.',
    sources: ['lib/testing/ci/schedule.ts', 'nightly.yml#full', 'nightly.yml#alert'],
    trigger: { on: 'time' },
  },
  'nightly-quarantine': {
    runs: "The list of quarantined tests in the nightly's summary (scripts/list-quarantines.ts).",
    sources: ['nightly.yml#quarantine'],
    trigger: { on: 'time' },
  },
  'main-full-run': {
    runs: "A full run of main's head when untested changes landed (fullRunDue).",
    sources: [
      'lib/testing/ci/full-run.ts',
      'main-full-run.yml#decide',
      'main-full-run.yml#full',
      'main-full-run.yml#alert',
    ],
    trigger: { on: 'time' },
  },
  'date-lookahead': {
    runs: 'The suite on the coming dates, one leg per date on a shifted clock.',
    sources: [
      'date-lookahead.yml#plan',
      'date-lookahead.yml#build',
      'date-lookahead.yml#leg',
      'date-lookahead.yml#alert',
    ],
    trigger: { on: 'time' },
  },
  'health-ci-queue': {
    runs: "The week's p90 wait of CI jobs for a machine, against its ceiling (.github/scripts/ci-queue.sh).",
    sources: ['health.yml#ci-queue'],
    trigger: { on: 'time' },
  },
  'health-pr-asset-branches': {
    runs: 'No pr-assets branch holds PR images (.github/scripts/pr-asset-branches.sh).',
    sources: ['health.yml#repository', 'health.yml#report'],
    trigger: { on: 'time' },
  },
  'release-candidate': {
    runs: "The release's gate: a green full run on the exact commit it ships, its own when none is found.",
    sources: ['lib/testing/ci/schedule.ts', 'release.yml#hold', 'release.yml#candidate', 'release.yml#full'],
    trigger: { on: 'time' },
  },
  'list-growth': {
    runs: 'Reruns Fast, and with it Check, when the owner adds or removes `approved: list growth`.',
    sources: ['list-growth.yml#rerun'],
    trigger: { on: 'event', event: 'list-growth-label' },
  },
  'pr-screenshots': {
    runs: "Deletes a closed pull request's images from the pr-screenshots release.",
    sources: ['pr-screenshots.yml#delete'],
    trigger: { on: 'event', event: 'pull-request-closed' },
  },
  'main-green-notice': {
    runs: "Tells each open PR whose Check failed that main's run turned green.",
    sources: ['main-green-notice.yml#notice'],
    trigger: { on: 'event', event: 'main-run-completed' },
  },
  'merge-queue-notice': {
    runs: "Tells a PR that the queue's run of it failed.",
    sources: ['merge-queue-notice.yml#notice'],
    trigger: { on: 'event', event: 'queue-run-completed' },
  },
} as const satisfies Record<string, ScheduleItem>;
export type ScheduleName = keyof typeof SCHEDULES;
export const SCHEDULE_NAMES = Object.keys(SCHEDULES).filter(
  (name): name is ScheduleName => name in SCHEDULES,
);

/** The schedules a profile gives a time; the others follow their event in every profile. */
export type TimedSchedule = {
  [Name in ScheduleName]: (typeof SCHEDULES)[Name]['trigger']['on'] extends 'time' ? Name : never;
}[ScheduleName];
export type EventSchedule = Exclude<ScheduleName, TimedSchedule>;

/**
 * The workflow jobs that are no CI work, with the reason. Each workflow job is either a source of
 * an inventory item, the CI run itself (ci.yml), or listed here.
 */
export const OUTSIDE_INVENTORY: Readonly<Record<string, string>> = {
  'health.yml#production': 'Checks PROD credentials, which only main may hold.',
  'release.yml#dev': 'Migrates DEV for the release: an environment change, not a check.',
  'release.yml#release': 'Ships to PROD.',
  'release.yml#smoke': 'Checks PROD after the release.',
  'release.yml#proof': "Proves the release's alert path.",
  'release.yml#alert': "Reports the release's failure.",
  'nightly.yml#proof': "Proves the nightly's alert path.",
  'staging.yml#migrate': 'Migrates DEV after a merge.',
  'staging.yml#deploy': 'Deploys staging after a merge.',
  'production-alert.yml#alert': "Writes the production watcher's alerts.",
};

/** One item of the inventory: a job, a kind of run, or a schedule. */
export type InventoryKey = `job:${CiJob}` | `run:${CiEvent}` | `schedule:${ScheduleName}`;

/** Every item CI must run, in a fixed order: the jobs, the kinds of run, the schedules. */
export const INVENTORY_KEYS: readonly InventoryKey[] = [
  ...CI_JOBS.map((job) => `job:${job}` as const),
  ...CI_EVENTS.map((event) => `run:${event}` as const),
  ...SCHEDULE_NAMES.map((name) => `schedule:${name}` as const),
];
