// The CI pipeline as data: its jobs, what each needs, and which events run it
// (docs/technical/testing.md, "CI"). scripts/ci/job.ts runs each job's body;
// .github/workflows/ci.yml and the stand-in runner schedule the jobs by this
// table, and dag.test.ts keeps ci.yml in step with it.

/**
 * - `pr`: a pull request's own run, draft or ready: the fast tier.
 * - `integration`: the landing candidate. A merge-queue entry, or on the stand-in without a queue
 *   the PR's up-to-date head.
 * - `main`: a push to `main`.
 * - `full`: every browser group: the nightly run, main's full run, the release gate.
 */
export const CI_EVENTS = ['pr', 'integration', 'main', 'full'] as const;
export type CiEvent = (typeof CI_EVENTS)[number];

export const CI_JOBS = ['plan', 'fast', 'sql', 'components', 'midnight', 'browser', 'check'] as const;
export type CiJob = (typeof CI_JOBS)[number];

type CiJobSpec = {
  /** The job's name in ci.yml; a browser shard's name adds its number. */
  name: string;
  needs: readonly CiJob[];
  events: readonly CiEvent[];
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
  plan: { name: 'Plan', needs: [], events: CI_EVENTS, reusable: false },
  fast: { name: 'Fast', needs: ['plan'], events: CI_EVENTS, reusable: false },
  sql: { name: 'SQL', needs: ['plan'], events: CI_EVENTS, reusable: true },
  components: { name: 'Component contracts', needs: ['plan'], events: CI_EVENTS, reusable: true },
  midnight: { name: 'Midnight wait', needs: ['plan'], events: AFTER_REVIEW, reusable: false },
  // A shard serves the fast job's build, so it needs that job instead of polling for it.
  browser: { name: 'Browser', needs: ['plan', 'fast', 'midnight'], events: AFTER_REVIEW, reusable: true },
  check: {
    name: 'Check',
    needs: ['plan', 'fast', 'sql', 'components', 'midnight', 'browser'],
    events: CI_EVENTS,
    reusable: false,
  },
};

/**
 * The events whose results may stand for each other on an identical tree. A full run is the
 * release's and the nightly's own proof, so it never reuses and is never reused.
 */
export const REUSE_EVENTS: readonly CiEvent[] = ['pr', 'integration', 'main'];
