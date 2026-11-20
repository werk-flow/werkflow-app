// Which jobs a CI run executes, and why each other job does not (scripts/ci/job.ts plan).
import { CI_DAG, CI_JOBS, type CiEvent, type CiJob } from './dag';
import type { CiShard, RunPlan } from './results';
import type { ReuseKey } from './reuse';

const PR_BROWSER_SKIP =
  "A pull request's run is the fast tier. Its browser groups run once, in the integration run (owner decision D1, werk-flow/werkflow-planning#503).";

/** A planner output read as a group list; empty when the key is missing or empty. */
export const groupList = (value: string | undefined): string[] => (value ? value.split(',') : []);

/**
 * The steps a job runs beside its verification groups, recorded in its result as groups too, so a
 * reused result covers them as well.
 */
const JOB_STEPS = {
  fast: ['step:build'],
  sql: ['step:types', 'step:seed'],
  components: [],
  browser: ['step:server'],
} as const;

/** The verification groups of a job that runs a fixed list; the planner may add `components`. */
export function verifyGroups(job: 'sql' | 'components', outputs: Readonly<Record<string, string>>): string[] {
  return job === 'sql' ? groupList(outputs.sql) : groupList(outputs.components ?? 'ui:contracts');
}

/** What a job's result lists as its groups: its verification groups, then its steps. */
const recordedGroups = (job: keyof typeof JOB_STEPS, groups: readonly string[]): string[] => [
  ...groups,
  ...JOB_STEPS[job],
];

function parseShards(value: string | undefined): CiShard[] {
  const parsed: unknown = JSON.parse(value ?? '[]');
  if (!Array.isArray(parsed)) throw new Error('The plan output `shards` is no list.');
  return parsed.map((entry: unknown) => {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      !('shard' in entry) ||
      !('groups' in entry) ||
      typeof entry.shard !== 'number' ||
      typeof entry.groups !== 'string'
    )
      throw new Error('The plan output `shards` holds an entry without a shard number and groups.');
    return { shard: entry.shard, groups: entry.groups };
  });
}

/**
 * The run's plan. A push to main whose tree an integration run passed runs no job and cites that
 * run. Otherwise every job of the event runs, except a browser selection that is empty, a midnight
 * hold that no shard waits for, and a job whose passed result `reused` finds for the same key.
 */
export function planRun(input: {
  event: CiEvent;
  tree: string;
  listGrowthApproved: boolean;
  /** The planner's `$GITHUB_OUTPUT` keys; undefined when `passedTree` made planning unnecessary. */
  outputs: Readonly<Record<string, string>> | undefined;
  /** The integration run that passed this tree, for a push to main. */
  passedTree: string | undefined;
  /** The receipt that stands for a job with this key, or undefined. */
  reused: (key: ReuseKey) => string | undefined;
}): RunPlan {
  const others = CI_JOBS.filter((job) => job !== 'plan' && job !== 'check');
  if (input.event === 'main' && input.passedTree !== undefined) {
    const reason = `The integration run ${input.passedTree} passed this exact tree.`;
    return {
      jobs: ['plan', 'check'],
      skips: Object.fromEntries(others.map((job) => [job, reason])),
      shards: [],
      outputs: { ...input.outputs, browser: 'false', shards: '[]', midnight_until: '' },
    };
  }
  const outputs = input.outputs ?? {};
  const keyOf = (job: 'sql' | 'components' | 'browser', groups: readonly string[]): ReuseKey => ({
    job,
    tree: input.tree,
    groups: recordedGroups(job, groups),
    listGrowthApproved: input.listGrowthApproved,
  });
  const skips: Partial<Record<CiJob, string>> = {};
  const runsBrowser = CI_DAG.browser.events.includes(input.event);
  const planned = runsBrowser ? parseShards(outputs.shards) : [];
  const reusedShards = planned.flatMap((shard) => {
    const receipt = input.reused(keyOf('browser', groupList(shard.groups)));
    return receipt ? [`shard ${shard.shard} by ${receipt}`] : [];
  });
  const shards = planned.filter((shard) => !input.reused(keyOf('browser', groupList(shard.groups))));
  if (!runsBrowser) skips.browser = PR_BROWSER_SKIP;
  else if (!planned.length) skips.browser = 'The plan selects no browser group.';
  else if (!shards.length) skips.browser = `Every shard reused a passed result: ${reusedShards.join(', ')}.`;
  const midnightUntil = shards.length ? (outputs.midnight_until ?? '') : '';
  if (!runsBrowser) skips.midnight = PR_BROWSER_SKIP;
  else if (!midnightUntil) skips.midnight = 'No browser shard waits for the midnight start window.';
  for (const job of ['sql', 'components'] as const) {
    const receipt = input.reused(keyOf(job, verifyGroups(job, outputs)));
    if (receipt) skips[job] = `Reused the passed result ${receipt} of this tree, group list and approval.`;
  }
  return {
    jobs: CI_JOBS.filter((job) => !skips[job]),
    skips,
    shards,
    outputs: {
      ...outputs,
      browser: shards.length ? 'true' : 'false',
      shards: JSON.stringify(shards),
      midnight_until: midnightUntil,
    },
  };
}
