// Which jobs a CI run executes, and why each other job does not (scripts/ci/job.ts plan).
import { CI_DAG, CI_JOBS, type CiEvent, type CiJob } from './dag';
import type { CiShard, RunPlan } from './results';
import type { ReuseKey } from './reuse';

const PR_BROWSER_SKIP =
  "A pull request's run is the fast tier. Its browser groups run once, in the integration run (owner decision D1, werk-flow/werkflow-planning#503).";

/** A planner output read as a group list; empty when the key is missing or empty. */
const groupList = (value: string | undefined): string[] => (value ? value.split(',') : []);

/**
 * The groups a job's result holds, in its order: the verification groups, then the steps it runs
 * beside them (`step:` ids), so a reused result covers both and `Check` can require every one.
 * A browser shard's groups come from its plan entry. Plan, midnight and check hold none.
 */
export function plannedGroups(
  job: CiJob,
  outputs: Readonly<Record<string, string>>,
  shardGroups?: string,
): string[] {
  switch (job) {
    case 'fast':
      return [
        ...groupList(outputs.lint ?? 'static:lint'),
        ...groupList(outputs.static),
        ...groupList(outputs.unit ?? 'unit:all'),
        'step:build',
      ];
    case 'sql':
      return [...groupList(outputs.sql), 'step:types', 'step:seed'];
    case 'components':
      return groupList(outputs.components ?? 'ui:contracts');
    case 'browser':
      return [...groupList(shardGroups), 'step:server'];
    case 'plan':
    case 'midnight':
    case 'check':
      return [];
  }
}

/** A recorded step beside the verification groups, such as `step:build`. */
export const isStep = (id: string): boolean => id.startsWith('step:');

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

/** The planner outputs every plan needs; an empty selection is an empty value, never a missing key. */
const PLANNER_OUTPUTS = ['browser', 'full', 'full_reason', 'shards', 'midnight_until', 'static', 'sql'];

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
      outputs: {
        browser: 'false',
        full: 'false',
        full_reason: '',
        shards: '[]',
        midnight_until: '',
        static: '',
        sql: '',
      },
    };
  }
  const outputs = input.outputs ?? {};
  const missing = PLANNER_OUTPUTS.filter((key) => outputs[key] === undefined);
  if (missing.length) throw new Error(`The planner gave no ${missing.join(', ')}, so nothing is planned.`);
  /** The receipt that stands for the job, when the DAG lets it be reused. */
  const reusedBy = (job: CiJob, shardGroups?: string): string | undefined =>
    CI_DAG[job].reusable
      ? input.reused({
          job,
          tree: input.tree,
          groups: plannedGroups(job, outputs, shardGroups),
          listGrowthApproved: input.listGrowthApproved,
        })
      : undefined;
  const skips: Partial<Record<CiJob, string>> = {};
  const runsBrowser = CI_DAG.browser.events.includes(input.event);
  const planned = runsBrowser ? parseShards(outputs.shards) : [];
  const reusedShards = planned.flatMap((shard) => {
    const receipt = reusedBy('browser', shard.groups);
    return receipt ? [`shard ${shard.shard} by ${receipt}`] : [];
  });
  const shards = planned.filter((shard) => !reusedBy('browser', shard.groups));
  if (!runsBrowser) skips.browser = PR_BROWSER_SKIP;
  else if (!planned.length) skips.browser = 'The plan selects no browser group.';
  else if (!shards.length) skips.browser = `Every shard reused a passed result: ${reusedShards.join(', ')}.`;
  const midnightUntil = shards.length ? (outputs.midnight_until ?? '') : '';
  if (!runsBrowser) skips.midnight = PR_BROWSER_SKIP;
  else if (!midnightUntil) skips.midnight = 'No browser shard waits for the midnight start window.';
  for (const job of others) {
    if (skips[job] || job === 'browser') continue;
    const receipt = reusedBy(job);
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
