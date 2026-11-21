// The CI pipeline as data: its jobs, what each needs, which events run it, the environment it takes
// and how long it may run (docs/technical/testing.md, "CI"). scripts/ci/job.ts runs each job's body
// and scripts/ci/prepare.ts its environment; .github/workflows/ci.yml and scripts/ci/run-commit.ts
// schedule the jobs by this table, and dag.test.ts keeps ci.yml and its actions in step with it
// (mirror.test.ts the CI mirror's workflow, ci/mirror/workflow.yml).

/**
 * - `pr`: a pull request's own run, draft or ready: the fast tier.
 * - `integration`: the landing candidate. A merge-queue entry, or on the stand-in without a queue
 *   the PR's up-to-date head.
 * - `main`: a push to `main`.
 * - `full`: every browser group: the nightly run, main's full run, the release gate.
 */
export const CI_EVENTS = ['pr', 'integration', 'main', 'full'] as const;
export type CiEvent = (typeof CI_EVENTS)[number];

export const CI_JOBS = [
  'plan',
  'fast',
  'sql',
  'components',
  'invoices',
  'midnight',
  'browser',
  'check',
] as const;
export type CiJob = (typeof CI_JOBS)[number];

/**
 * The environment steps of scripts/ci/prepare.ts, which every runner takes before a job body: the
 * composites of .github/actions call them on GitHub Actions, scripts/ci/run-commit.ts everywhere else.
 * - `install`: the pinned Bun and Node, and the locked dependencies.
 * - `siblings`: the sibling clones beside the checkout that docs:check reads.
 * - `approval`: the owner's `approved: list growth` label of the run's pull requests.
 * - `stack-environment`: the stack's environment file, starting the stack only when it is missing.
 * - `stack`: a fresh stack with every committed migration, published on loopback only.
 * - `env`: .env.local pointed at the stack.
 * - `playwright`, `playwright-packages`: the host Chromium, then its missing system packages.
 */
export const PREPARE_STEPS = [
  'install',
  'siblings',
  'approval',
  'stack-environment',
  'stack',
  'env',
  'playwright',
  'playwright-packages',
] as const;
export type PrepareStep = (typeof PREPARE_STEPS)[number];

/** The tools CI pins: scripts/ci/prepare.ts refuses others, and the actions' versions and cache keys name the same. */
export const CI_TOOLS = { bun: '1.4.4', nodeMajor: 22, supabaseCli: '2.116.0' } as const;

type CiJobSpec = {
  /** The job's name in ci.yml; a browser shard's name adds its number. */
  name: string;
  needs: readonly CiJob[];
  events: readonly CiEvent[];
  /** The steps of scripts/ci/prepare.ts the job takes before its body, in order. */
  prepare: readonly PrepareStep[];
  /** Its whole time, setup included, as ci.yml's `timeout-minutes`; every runner ends it then. */
  timeoutMinutes: number;
  /** Whether it reads GitHub with the run's token (GH_TOKEN): the queue's runs, open PRs' migrations, labels. */
  githubToken: boolean;
  /**
   * Whether a passed result for an identical tree, group list and list-growth approval stands for
   * a new run of the job. The fast tier's static gates read facts outside the tree (open PRs'
   * migrations, the sibling repositories, the advisory database), so it always runs.
   */
  reusable: boolean;
};

/** Owner decision D1 (werk-flow/werkflow-planning#503): browser groups run once per PR, in the integration run. */
const AFTER_REVIEW: readonly CiEvent[] = ['integration', 'main', 'full'];

export const CI_DAG: Readonly<Record<CiJob, CiJobSpec>> = {
  plan: {
    name: 'Plan',
    needs: [],
    events: CI_EVENTS,
    reusable: false,
    prepare: ['install'],
    timeoutMinutes: 10,
    githubToken: true,
  },
  fast: {
    name: 'Fast',
    needs: ['plan'],
    events: CI_EVENTS,
    reusable: false,
    prepare: ['install', 'siblings', 'approval', 'stack-environment'],
    timeoutMinutes: 30,
    githubToken: true,
  },
  sql: {
    name: 'SQL',
    needs: ['plan'],
    events: CI_EVENTS,
    reusable: true,
    prepare: ['install', 'stack', 'env'],
    timeoutMinutes: 20,
    githubToken: false,
  },
  components: {
    name: 'Component contracts',
    needs: ['plan'],
    events: CI_EVENTS,
    reusable: true,
    prepare: ['install', 'playwright', 'playwright-packages'],
    timeoutMinutes: 20,
    githubToken: false,
  },
  // The reference invoices through Mustang and veraPDF, when the plan selects them. Every tool is
  // pinned by checksum or digest, so a pass of the tree stands.
  invoices: {
    name: 'E-invoices',
    needs: ['plan'],
    events: CI_EVENTS,
    reusable: true,
    prepare: ['install'],
    timeoutMinutes: 20,
    githubToken: false,
  },
  midnight: {
    name: 'Midnight wait',
    needs: ['plan'],
    events: AFTER_REVIEW,
    reusable: false,
    prepare: ['install'],
    timeoutMinutes: 110,
    githubToken: false,
  },
  // A shard serves the fast job's build, so it needs that job instead of polling for it.
  browser: {
    name: 'Browser',
    needs: ['plan', 'fast', 'midnight'],
    events: AFTER_REVIEW,
    reusable: true,
    prepare: ['install', 'stack', 'env', 'playwright', 'playwright-packages'],
    timeoutMinutes: 45,
    githubToken: false,
  },
  check: {
    name: 'Check',
    needs: ['plan', 'fast', 'sql', 'components', 'invoices', 'midnight', 'browser'],
    events: CI_EVENTS,
    reusable: false,
    prepare: ['install'],
    timeoutMinutes: 10,
    githubToken: false,
  },
};

/**
 * Where a part of a job runs on the CI mirror (scripts/ci/mirror-executor.ts), which holds only the
 * tested tree, as one parentless commit, and no credential: `tree` there, `host` on the
 * orchestrator's host. A runner that holds the whole job sets no part (CI_PART unset).
 */
const CI_PARTS = ['tree', 'host'] as const;
export type CiPart = (typeof CI_PARTS)[number];

/**
 * The environment steps that read outside the tested tree: the sibling clones (one private, read
 * with a token) and the labels of the run's pull requests (read with the GitHub token).
 */
const HOST_STEPS: readonly PrepareStep[] = ['siblings', 'approval'];

/**
 * The Fast groups that read outside the tested tree: docs:check reads the sibling clones and the
 * decision records' published history, migrations:order the base's migrations and the open pull
 * requests'. Only Fast runs them, on the host alone.
 */
export const HOST_GROUPS: readonly string[] = ['static:docs', 'static:migration-order'];

/** The unit group, which both parts of Fast run: each its own files of it (partUnitFiles). */
const SPLIT_GROUP = 'unit:all';

/**
 * The unit test files that read the repository's history or the run's list growth approval: the
 * shrink-only lists compare with the merge base with origin/main, which a parentless commit lacks.
 * They run in Fast's host part; every other unit test file runs on the mirror.
 */
const HOST_UNIT_TESTS: readonly string[] = ['lib/testing/publication/shrink-only-lists.test.ts'];

/**
 * The part a runner gives (CI_PART), undefined for the whole job. Only Fast has a host part;
 * anything else throws.
 */
export function partOf(value: string | undefined, job?: CiJob): CiPart | undefined {
  if (!value) return undefined;
  const part = CI_PARTS.find((name) => name === value);
  if (!part) throw new Error(`CI_PART ${value} is no part: ${CI_PARTS.join(' or ')}.`);
  if (part === 'host' && job !== undefined && job !== 'fast')
    throw new Error(`Only Fast has a host part, not ${job}.`);
  return part;
}

/**
 * A job part's environment steps: the whole job's without the host steps on the mirror, and on the
 * host the install and the host steps only.
 */
export function partSteps(job: CiJob, part: CiPart | undefined): PrepareStep[] {
  const steps = CI_DAG[job].prepare;
  if (part === 'tree') return steps.filter((step) => !HOST_STEPS.includes(step));
  if (part === 'host') return steps.filter((step) => step === 'install' || HOST_STEPS.includes(step));
  return [...steps];
}

/**
 * A job part's groups of `planned`, in order: the whole list without a part. The unit group is in
 * both parts, each running its own files of it.
 */
export function partGroups(planned: readonly string[], part: CiPart | undefined): string[] {
  if (part === 'tree') return planned.filter((group) => !HOST_GROUPS.includes(group));
  if (part === 'host') return planned.filter((group) => HOST_GROUPS.includes(group) || group === SPLIT_GROUP);
  return [...planned];
}

/**
 * A part's unit test files of `files` (repository paths): all of them without a part. The host part
 * throws when a host file is missing: with no file named, the runner would run the whole suite there.
 */
export function partUnitFiles(files: readonly string[], part: CiPart | undefined): string[] {
  const host = (file: string): boolean => HOST_UNIT_TESTS.includes(file.replace(/^\.\//, ''));
  if (part === 'tree') return files.filter((file) => !host(file));
  if (part !== 'host') return [...files];
  const hosted = files.filter(host);
  if (hosted.length !== HOST_UNIT_TESTS.length)
    throw new Error(`The host part's unit test files are not all here: ${HOST_UNIT_TESTS.join(', ')}.`);
  return hosted;
}

/** Whether a group runs in both parts of Fast, so its outcome needs both. */
export const splitGroup = (group: string): boolean => group === SPLIT_GROUP;

/**
 * The events whose results may stand for each other on an identical tree. A full run is the
 * release's and the nightly's own proof, so it never reuses and is never reused.
 */
export const REUSE_EVENTS: readonly CiEvent[] = ['pr', 'integration', 'main'];
