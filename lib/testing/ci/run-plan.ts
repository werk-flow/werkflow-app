// Which jobs a CI run executes, and why each other job does not (scripts/ci/job.ts plan).
import { CI_DAG, CI_JOBS, type CiEvent, type CiJob } from './dag';
import type { CiShard, RunPlan } from './results';
import type { ReuseKey } from './reuse';

const PR_BROWSER_SKIP =
  "A pull request's run is the fast tier. Its browser groups run once, in the integration run (owner decision D1, werk-flow/werkflow-planning#503).";

/** A planner output read as a group list; empty when the key is missing or empty. */
const groupList = (value: string | undefined): string[] => (value ? value.split(',') : []);

/**
 * The groups a job's result holds, in its order: the planner's selection for the job
 * (lib/testing/selection/fast-tier.ts), then the steps it runs beside them (`step:` ids), so a
 * reused result covers both and `Check` can require every one. A browser or component shard's
 * groups come from its plan entry. Plan, midnight and check hold none.
 */
export function plannedGroups(
  job: CiJob,
  outputs: Readonly<Record<string, string>>,
  shardGroups?: string,
): string[] {
  switch (job) {
    case 'fast':
      return [
        ...groupList(outputs.selected_lint),
        ...groupList(outputs.selected_static),
        ...groupList(outputs.selected_unit),
        'step:build',
      ];
    case 'sql':
      return [...groupList(outputs.selected_sql), 'step:types', 'step:seed'];
    case 'components':
      return groupList(shardGroups);
    case 'invoices':
      return groupList(outputs.selected_invoices);
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

/** A plan's shards; each entry has a positive whole shard number and only non-empty group ids. */
function parseShards(value: string | undefined, key = 'shards'): CiShard[] {
  const parsed: unknown = JSON.parse(value ?? '[]');
  if (!Array.isArray(parsed)) throw new Error(`The plan output \`${key}\` is no list.`);
  return parsed.map((entry: unknown) => {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      !('shard' in entry) ||
      !('groups' in entry) ||
      typeof entry.shard !== 'number' ||
      !Number.isInteger(entry.shard) ||
      entry.shard < 1 ||
      typeof entry.groups !== 'string' ||
      !entry.groups.split(',').every(Boolean)
    )
      throw new Error(`The plan output \`${key}\` holds an entry without a shard number and groups.`);
    return { shard: entry.shard, groups: entry.groups };
  });
}

/**
 * The shards of a job that runs as several jobs, each with its own result: the browser shards and
 * the component shards. Undefined for a job with one result.
 */
export function jobShards(job: CiJob, plan: RunPlan): CiShard[] | undefined {
  if (job === 'browser') return plan.shards;
  if (job === 'components') return parseShards(plan.outputs.component_shards, 'component_shards');
  return undefined;
}

/**
 * The shards of the planner output `key`. Their numbers are unique and they hold each group once:
 * exactly the `selected` groups when the planner lists them.
 */
function checkedShards(
  outputs: Readonly<Record<string, string>>,
  key: string,
  selected?: string[],
): CiShard[] {
  const shards = parseShards(outputs[key], key);
  if (new Set(shards.map((entry) => entry.shard)).size !== shards.length)
    throw new Error(`The plan output \`${key}\` repeats a shard number.`);
  const held = shards.flatMap((entry) => groupList(entry.groups));
  if (
    new Set(held).size !== held.length ||
    (selected && held.toSorted().join() !== selected.toSorted().join())
  )
    throw new Error(`The plan output \`${key}\` does not hold each selected group exactly once.`);
  return shards;
}

/** The planner outputs every plan needs; an empty selection is an empty value, never a missing key. */
const PLANNER_OUTPUTS = [
  'browser',
  'full',
  'full_reason',
  'shards',
  'midnight_until',
  'static',
  'sql',
  'selected_lint',
  'selected_static',
  'selected_unit',
  'selected_sql',
  'selected_components',
  'component_shards',
  'selected_invoices',
];

/**
 * The planner keys `outputs` lacks. A missing key would read as an empty selection and drop its
 * gates, so Plan refuses such a planner answer, and every later job such a plan.
 */
export const missingPlannerOutputs = (outputs: Readonly<Record<string, string>>): string[] =>
  PLANNER_OUTPUTS.filter((key) => outputs[key] === undefined);

/** The jobs between Plan and Check. */
const WORK_JOBS = CI_JOBS.filter((job) => job !== 'plan' && job !== 'check');

/** A push's plan whose tree `passedTree` passed: no job runs, and every planner key stays, empty. */
function reusedTreePlan(passedTree: string, work: string[]): RunPlan {
  const reason = `The integration run ${passedTree} passed this exact tree.`;
  const empty: Readonly<Record<string, string>> = {
    browser: 'false',
    full: 'false',
    shards: '[]',
    component_shards: '[]',
  };
  return {
    jobs: ['plan', 'check'],
    skips: Object.fromEntries(WORK_JOBS.map((job) => [job, reason])),
    shards: [],
    outputs: Object.fromEntries(PLANNER_OUTPUTS.map((key) => [key, empty[key] ?? ''])),
    work,
  };
}

/** The planner's browser and component shards, after every check that they stand for its selection. */
function plannedShards(outputs: Readonly<Record<string, string>>): {
  browser: CiShard[];
  components: CiShard[];
} {
  const missing = missingPlannerOutputs(outputs);
  if (missing.length) throw new Error(`The planner gave no ${missing.join(', ')}, so nothing is planned.`);
  const browser = checkedShards(outputs, 'shards');
  if ((outputs.browser === 'true') !== browser.length > 0)
    throw new Error('The plan output `browser` contradicts its `shards`.');
  return {
    browser,
    components: checkedShards(outputs, 'component_shards', groupList(outputs.selected_components)),
  };
}

/**
 * The work `event` requires of the planner's selection, before any reuse: `job:group` for every
 * group of every job the event runs and the selection does not skip, each shard's included,
 * sorted. Two runs of one tree stand for each other only when they require the same work
 * (lib/testing/ci/reuse.ts).
 */
export function plannedWork(event: CiEvent, outputs: Readonly<Record<string, string>>): string[] {
  const shards = plannedShards(outputs);
  const skips = emptySelectionSkips(outputs);
  return WORK_JOBS.filter((job) => CI_DAG[job].events.includes(event) && !skips[job])
    .flatMap((job) => {
      const split = job === 'browser' || job === 'components' ? shards[job] : undefined;
      const groups = split
        ? split.flatMap((shard) => plannedGroups(job, outputs, shard.groups))
        : plannedGroups(job, outputs);
      return [...new Set(groups)].map((group) => `${job}:${group}`);
    })
    .toSorted();
}

/** Why the SQL and e-invoice jobs skip when the planner selected nothing for them. */
function emptySelectionSkips(outputs: Readonly<Record<string, string>>): Partial<Record<CiJob, string>> {
  const skips: Partial<Record<CiJob, string>> = {};
  if (!groupList(outputs.selected_sql).length)
    skips.sql =
      "The plan selects no SQL group: no change reaches the schema, an assertion, the generated types or the SQL job's scripts (lib/testing/selection/fast-tier.ts).";
  if (!groupList(outputs.selected_invoices).length)
    skips.invoices =
      'The plan selects no e-invoice check: no change reaches the invoice core, the renderer, what they import or the dependencies (lib/testing/selection/e-invoice-selection.ts).';
  return skips;
}

/**
 * The run's plan, with the work its event requires. A push to main whose landing an integration
 * run passed runs no job and cites that run. Otherwise every job of the event runs, except a job whose selection is empty, a midnight
 * hold that no shard waits for, and a job or shard whose passed result `reused` finds for the same
 * key.
 */
export function planRun(input: {
  event: CiEvent;
  tree: string;
  /** The commit the Plan diffs against, resolved; null for a full run. Part of every reuse key. */
  base: string | null;
  listGrowthApproved: boolean;
  /** The planner's `$GITHUB_OUTPUT` keys. */
  outputs: Readonly<Record<string, string>>;
  /** The integration run that passed this landing (same tree, base and work), for a push to main. */
  passedTree: string | undefined;
  /** The receipt that stands for a job with this key, or undefined. */
  reused: (key: ReuseKey) => string | undefined;
}): RunPlan {
  const outputs = input.outputs;
  const work = plannedWork(input.event, outputs);
  if (input.event === 'main' && input.passedTree) return reusedTreePlan(input.passedTree, work);
  const { browser: browserShards, components: componentShards } = plannedShards(outputs);
  /** The receipt that stands for the job or shard, when the DAG lets it be reused. */
  const reusedBy = (job: CiJob, shard?: CiShard): string | undefined =>
    CI_DAG[job].reusable
      ? input.reused({
          job,
          shard: shard?.shard ?? null,
          tree: input.tree,
          base: input.base,
          groups: plannedGroups(job, outputs, shard?.groups),
          listGrowthApproved: input.listGrowthApproved,
        })
      : undefined;
  const skips = emptySelectionSkips(outputs);
  const reusedJobs: NonNullable<RunPlan['reused']> = [];
  /** The planned shards that no passed result stands for, and why the job skips when none is left. */
  const shardsToRun = (job: CiJob, planned: CiShard[], none: string): CiShard[] => {
    const reused = planned.flatMap((shard) => {
      const receipt = reusedBy(job, shard);
      return receipt ? [{ shard, receipt }] : [];
    });
    for (const entry of reused) reusedJobs.push({ job, shard: entry.shard.shard, runUrl: entry.receipt });
    const left = planned.filter((shard) => !reused.some((entry) => entry.shard === shard));
    if (!planned.length) skips[job] = none;
    else if (!left.length)
      skips[job] =
        `Every shard reused a passed result: ${reused.map((entry) => `shard ${entry.shard.shard} by ${entry.receipt}`).join(', ')}.`;
    return left;
  };
  const runsBrowser = CI_DAG.browser.events.includes(input.event);
  const shards = runsBrowser
    ? shardsToRun('browser', browserShards, 'The plan selects no browser group.')
    : [];
  if (!runsBrowser) skips.browser = PR_BROWSER_SKIP;
  const midnightUntil = shards.length ? (outputs.midnight_until ?? '') : '';
  if (!runsBrowser) skips.midnight = PR_BROWSER_SKIP;
  else if (!midnightUntil) skips.midnight = 'No browser shard waits for the midnight start window.';
  const componentsToRun = shardsToRun(
    'components',
    componentShards,
    'The plan selects no component area: no change reaches a contract, its bundle or a stylesheet (lib/testing/selection/fast-tier.ts).',
  );
  for (const job of WORK_JOBS) {
    if (skips[job] || job === 'browser' || job === 'components') continue;
    const receipt = reusedBy(job);
    if (!receipt) continue;
    skips[job] = `Reused the passed result ${receipt} of this tree, group list and approval.`;
    reusedJobs.push({ job, shard: null, runUrl: receipt });
  }
  return {
    jobs: CI_JOBS.filter((job) => !skips[job]),
    skips,
    shards,
    outputs: {
      ...outputs,
      browser: shards.length ? 'true' : 'false',
      shards: JSON.stringify(shards),
      component_shards: JSON.stringify(componentsToRun),
      midnight_until: midnightUntil,
    },
    reused: reusedJobs,
    work,
  };
}

/**
 * The notice that the run's browser shards wait for the midnight start window, from the final plan
 * after reuse; undefined when no shard left to run waits.
 */
export function midnightNotice(plan: RunPlan, proofRun: boolean): string | undefined {
  const until = plan.outputs.midnight_until;
  return until
    ? `This run waits on purpose${proofRun ? ' (proof run)' : ''}: the browser shards start at ${until}. No browser group starts from 23:40 to 00:10 Berlin time, and a Browser job that started now could reach that window within its timeout. The other jobs run meanwhile; Check reports after the shards.`
    : undefined;
}
