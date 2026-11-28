// Everything CI must run, in one list (decision 0011, docs/decisions/0011-ci-profiles.md). Each CI
// profile (lib/testing/ci/profiles.ts) places every item of it; only where and when may differ.
// The jobs and run kinds come from the DAG (dag.ts), the group kinds from the test-group registry
// (lib/testing/selection/test-groups.ts), and the schedules from the conductor's rules
// (schedule.ts, full-run.ts) and the workflows that start them. inventory.test.ts keeps each
// schedule's sources and triggers in step with the workflows folder.
import { BERLIN_TIME_ZONE } from '../../date-time/berlin';
import type { TestGroup } from '../selection/test-groups';
import type { ClockWorkName } from './schedule';
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

/** One `on.schedule` entry of a workflow, as written there: GitHub's clock. */
type WorkflowCron = { workflow: string; cron: string; timezone?: typeof BERLIN_TIME_ZONE };

/** The conductor's clocks: `CLOCK_WORK` (schedule.ts) and the full-run slots (full-run.ts). */
type ConductorClock = ClockWorkName | 'full-run';

/**
 * What fires a timed schedule: its workflow's cron on GitHub, the conductor's clock, or both where
 * they differ. A profile names the clock it uses (profiles.ts); one with neither cannot be written.
 */
type TimeTrigger = { on: 'time' } & (
  | { workflow: WorkflowCron; conductor?: ConductorClock }
  | { workflow?: undefined; conductor: ConductorClock }
);

/** The GitHub event that dispatches a workflow, as its `on:` says. */
type GitHubEvent =
  /** No `branches`: every base, as a stacked PR's. */
  | { workflow: string; on: 'pull_request'; branches?: readonly string[]; types: readonly string[] }
  | {
      workflow: string;
      on: 'workflow_run';
      workflows: readonly string[];
      branches: readonly string[];
      types: readonly string[];
    };

/** What starts a schedule: a CI event such as a closed pull request, or a clock. */
export type ScheduleTrigger = TimeTrigger | { on: 'event'; event: string; github: GitHubEvent };

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
    sources: ['lib/testing/ci/schedule.ts', 'nightly.yml#decide', 'nightly.yml#full', 'nightly.yml#alert'],
    trigger: {
      on: 'time',
      workflow: { workflow: 'nightly.yml', cron: '0 17 * * *', timezone: BERLIN_TIME_ZONE },
      conductor: 'nightly',
    },
  },
  'nightly-quarantine': {
    runs: "The list of quarantined tests in the nightly's summary (scripts/list-quarantines.ts).",
    sources: ['nightly.yml#quarantine'],
    trigger: {
      on: 'time',
      workflow: { workflow: 'nightly.yml', cron: '0 17 * * *', timezone: BERLIN_TIME_ZONE },
    },
  },
  'main-full-run': {
    runs: "A full run of main's head when untested changes landed (fullRunDue).",
    sources: [
      'lib/testing/ci/full-run.ts',
      'main-full-run.yml#decide',
      'main-full-run.yml#full',
      'main-full-run.yml#alert',
    ],
    // main-full-run.yml has no cron: the conductor's slots or a manual dispatch start it.
    trigger: { on: 'time', conductor: 'full-run' },
  },
  'date-lookahead': {
    runs: 'The suite on the coming dates, one leg per date on a shifted clock.',
    sources: [
      'date-lookahead.yml#plan',
      'date-lookahead.yml#build',
      'date-lookahead.yml#leg',
      'date-lookahead.yml#alert',
    ],
    trigger: { on: 'time', workflow: { workflow: 'date-lookahead.yml', cron: '15 5 * * *' } },
  },
  'health-ci-queue': {
    runs: "The week's p90 wait of CI jobs for a machine, against its ceiling (.github/scripts/ci-queue.sh).",
    sources: ['health.yml#ci-queue'],
    trigger: { on: 'time', workflow: { workflow: 'health.yml', cron: '0 5 * * 1' } },
  },
  'health-pr-asset-branches': {
    runs: 'No pr-assets branch holds PR images (.github/scripts/pr-asset-branches.sh): the one key-free check of health.yml#repository (HEALTH_CHECKS).',
    sources: ['health.yml#repository', 'health.yml#report'],
    trigger: { on: 'time', workflow: { workflow: 'health.yml', cron: '0 5 * * 1' } },
  },
  'release-candidate': {
    runs: "The release's gate: a green full run on the exact commit it ships, its own when none is found.",
    sources: ['lib/testing/ci/schedule.ts', 'release.yml#candidate', 'release.yml#full'],
    // release.yml has no cron: a dispatch at the conductor's `release` clock, 03:30 on weekdays,
    // starts it. On GitHub Actions the ci-alert timer dispatches it (profiles.ts).
    trigger: { on: 'time', conductor: 'release' },
  },
  'list-growth': {
    runs: 'Reruns Fast, and with it Check, when the owner adds or removes `approved: list growth`.',
    sources: ['list-growth.yml#rerun'],
    trigger: {
      on: 'event',
      event: 'list-growth-label',
      github: {
        workflow: 'list-growth.yml',
        on: 'pull_request',
        types: ['labeled', 'unlabeled'],
      },
    },
  },
  'pr-screenshots': {
    runs: "Deletes a closed pull request's images from the pr-screenshots release.",
    sources: ['pr-screenshots.yml#delete'],
    trigger: {
      on: 'event',
      event: 'pull-request-closed',
      github: { workflow: 'pr-screenshots.yml', on: 'pull_request', branches: ['main'], types: ['closed'] },
    },
  },
  'main-green-notice': {
    runs: "Tells each open PR whose Check failed that main's run turned green.",
    sources: ['main-green-notice.yml#notice'],
    trigger: {
      on: 'event',
      event: 'main-run-completed',
      github: {
        workflow: 'main-green-notice.yml',
        on: 'workflow_run',
        workflows: ['CI'],
        branches: ['main'],
        types: ['completed'],
      },
    },
  },
  'merge-queue-notice': {
    runs: "Tells a PR that the queue's run of it failed.",
    sources: ['merge-queue-notice.yml#notice'],
    trigger: {
      on: 'event',
      event: 'queue-run-completed',
      github: {
        workflow: 'merge-queue-notice.yml',
        on: 'workflow_run',
        workflows: ['CI'],
        branches: ['gh-readonly-queue/**'],
        types: ['completed'],
      },
    },
  },
  'retarget-notice': {
    runs: 'Asks a PR whose base changed for a new head, so CI runs on the new base.',
    sources: ['retarget-notice.yml#notice'],
    trigger: {
      on: 'event',
      event: 'pull-request-retargeted',
      github: { workflow: 'retarget-notice.yml', on: 'pull_request', types: ['edited'] },
    },
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
 * Each check of health.yml by its `break_check` id: its job, whether it needs a credential
 * (`keyed`) or none (`key-free`), and where it runs. A keyed check reads DEV, PROD or a vendor with a
 * secret only GitHub holds, so it stays on the shared GitHub workflow in every profile; a key-free
 * check is CI work, an inventory item each profile places. inventory.test.ts holds the list to
 * health.yml's steps and their secrets.
 */
export const HEALTH_CHECKS = {
  'supabase-access-token-dev': { job: 'repository', key: 'keyed', runs: 'github' },
  'supabase-access-token-prod': { job: 'repository', key: 'keyed', runs: 'github' },
  'dev-database-url': { job: 'repository', key: 'keyed', runs: 'github' },
  'supabase-dev-read-token': { job: 'repository', key: 'keyed', runs: 'github' },
  'vercel-token': { job: 'repository', key: 'keyed', runs: 'github' },
  'vercel-build-step': { job: 'repository', key: 'keyed', runs: 'github' },
  'pr-asset-branches': { job: 'repository', key: 'key-free', runs: 'health-pr-asset-branches' },
  'sibling-repositories-token': { job: 'repository', key: 'keyed', runs: 'github' },
  'app-staging': { job: 'repository', key: 'keyed', runs: 'github' },
  'app-production': { job: 'repository', key: 'keyed', runs: 'github' },
  'supabase-function-dev': { job: 'repository', key: 'keyed', runs: 'github' },
  'supabase-function-prod': { job: 'repository', key: 'keyed', runs: 'github' },
  'ci-queue': { job: 'ci-queue', key: 'key-free', runs: 'health-ci-queue' },
  'prod-database-url': { job: 'production', key: 'keyed', runs: 'github' },
  'production-deploy-key': { job: 'production', key: 'keyed', runs: 'github' },
} as const satisfies Record<
  string,
  | { job: string; key: 'keyed'; runs: 'github' }
  | { job: string; key: 'key-free'; runs: 'health-ci-queue' | 'health-pr-asset-branches' }
>;

/**
 * The workflow jobs that are no CI work, with the reason. Each workflow job is either a source of
 * an inventory item, the CI run itself (ci.yml), or listed here.
 */
export const OUTSIDE_INVENTORY: Readonly<Record<string, string>> = {
  'health.yml#production': 'Checks PROD credentials, which only main may hold (HEALTH_CHECKS: keyed).',
  'release.yml#dev': 'Migrates DEV for the release: an environment change, not a check.',
  'release.yml#release': 'Ships to PROD.',
  'release.yml#smoke': 'Checks PROD after the release.',
  'release.yml#proof': "Proves the release's alert path.",
  'release.yml#alert': "Reports the release's failure.",
  'rulesets.yml#watch': 'Reads the live GitHub rulesets, a setting outside the code: no check of a commit.',
  'nightly.yml#proof': "Proves the nightly's alert path.",
  'mustang-cache.yml#seed': "Keeps Mustang's pinned jar in main's Actions cache: no check.",
  'staging.yml#migrate': 'Migrates DEV after a merge.',
  'staging.yml#deploy': 'Deploys staging after a merge.',
  'production-alert.yml#alert': "Writes ci-alert's release and Boat key alerts as github-actions.",
  'prod-inspect.yml#inspect': "Reads PROD's structure with a read-only token, which only main may hold.",
  'prod-inspect.yml#auth': "Reads PROD's auth settings and copies mailer fields to DEV, when dispatched.",
  'prod-inspect.yml#report': "Reports the inspection's failure.",
  'prod-watch.yml#watch':
    "Watches production's deployments and error counts with its token, which only main may hold.",
};

/** One item of the inventory: a job, a kind of run, or a schedule. */
export type InventoryKey = `job:${CiJob}` | `run:${CiEvent}` | `schedule:${ScheduleName}`;

/** Every item CI must run, in a fixed order: the jobs, the kinds of run, the schedules. */
export const INVENTORY_KEYS: readonly InventoryKey[] = [
  ...CI_JOBS.map((job) => `job:${job}` as const),
  ...CI_EVENTS.map((event) => `run:${event}` as const),
  ...SCHEDULE_NAMES.map((name) => `schedule:${name}` as const),
];
