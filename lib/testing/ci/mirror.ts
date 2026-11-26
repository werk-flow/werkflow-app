// What the orchestrator decides about the CI mirror (scripts/ci/mirror-executor.ts): the branch of
// each job start, whether a result the mirror returned is this run's own, how Fast's two parts
// form its one result, and which branches are stale. It starts and reads nothing itself.
import { CI_DAG, type CiEvent, type CiJob, partGroups, splitGroup } from './dag';
import type { CiResult, PlanIdentity } from './results';

/** The mirror's own workflow, the only one its pushed tree holds (scripts/ci/mirror-push.ts). */
export const MIRROR_WORKFLOW = '.github/workflows/ci-mirror.yml';
/** Where the pushed tree keeps the source's workflows, which tests and tools read (CI_WORKFLOWS_DIR). */
export const HELD_WORKFLOWS = '.github/held-workflows';
/**
 * The most mirror jobs this host runs at once, every run together. The mirror's GitHub Team plan runs
 * 60 jobs at once; the other 4 stay free for the mirror work outside these slots (the daily date
 * look-ahead's legs, the health jobs), so a run's jobs never queue behind them on GitHub.
 */
export const MIRROR_JOB_CAP = 56;
/** A `ci/**` branch whose commit is older than this is swept. */
const MIRROR_BRANCH_TTL_MS = 24 * 60 * 60_000;

type Unit = { job: CiJob; shard: number | null };

/**
 * The branch of one job start: the source commit, the run's key (a digest of its run URL, and its
 * attempt: ExecutorSetup.runKey) and the job or shard. Two runs of one commit, such as its pull
 * request run and its queue run, never share a branch; the workflow runs the job its last segment
 * names.
 */
export function mirrorBranch(commit: string, runKey: string, unit: Unit): string {
  return `ci/${commit}-${runKey}/${unit.shard === null ? unit.job : `${unit.job}-${unit.shard}`}`;
}

/** What a mirror job's result must name: this run, attempt, unit, source and Plan. */
export type ExpectedResult = Unit & {
  event: CiEvent;
  commit: string;
  tree: string;
  runUrl: string;
  attempt: number;
  producer: string | null;
  planIdentity: PlanIdentity;
};

const samePlan = (left: PlanIdentity | undefined, right: PlanIdentity): boolean =>
  left !== undefined &&
  left.runUrl === right.runUrl &&
  left.attempt === right.attempt &&
  left.startedAt === right.startedAt &&
  left.base === right.base &&
  left.digest === right.digest;

/**
 * Why a result the mirror or the host part returned is not this job's own ended result of this
 * run, attempt, source commit and tree and Plan, or undefined when it is.
 */
export function foreignResult(result: CiResult, expected: ExpectedResult): string | undefined {
  const mismatches = [
    result.job !== expected.job && `job ${result.job}`,
    result.shard !== expected.shard && `shard ${result.shard ?? 'none'}`,
    result.event !== expected.event && `event ${result.event}`,
    result.commit !== expected.commit && `commit ${result.commit}`,
    result.tree !== expected.tree && `tree ${result.tree}`,
    result.runUrl !== expected.runUrl && `run ${result.runUrl ?? 'none'}`,
    result.attempt !== expected.attempt && `attempt ${result.attempt ?? 'none'}`,
    result.producer !== expected.producer && `producer ${result.producer ?? 'none'}`,
    !samePlan(result.planIdentity, expected.planIdentity) && 'another Plan',
    (result.status === 'running' || result.completedAt === null) && 'no end',
  ].filter((mismatch) => typeof mismatch === 'string');
  return mismatches.length ? `it names ${mismatches.join(', ')}` : undefined;
}

type FastPart = { result: CiResult; passed: boolean };

/**
 * Fast's one result from its two parts: the mirror's (`tree`) and the host's (`host`). Each part
 * must be this run's own (foreignResult) and hold exactly its own groups of `planned` (partGroups).
 * The unit group, which both run, passed only when both passed. The result passed only when each
 * part passed by its process (`passed`) and its result. The list growth approval is the host's,
 * which read the labels and ran the one test that reads it; the cost is the mirror machine's.
 */
export function joinFastParts(
  parts: { tree: FastPart; host: FastPart },
  planned: readonly string[],
): CiResult | { problem: string } {
  const { tree, host } = parts;
  for (const [part, { result }] of [
    ['tree', tree],
    ['host', host],
  ] as const) {
    const own = partGroups(planned, part);
    const ids = result.groups.map((group) => group.id);
    if (ids.join() !== own.join())
      return { problem: `the ${part} part holds ${ids.join(', ') || 'no group'}, not its ${own.join(', ')}` };
  }
  const groups = planned.map((id): CiResult['groups'][number] => {
    const outcomes = [...tree.result.groups, ...host.result.groups].filter((group) => group.id === id);
    const [first] = outcomes;
    if (!first) return { id, outcome: 'not-run', durationMs: 0 };
    if (!splitGroup(id)) return first;
    const failed = outcomes.find((group) => group.outcome !== 'passed');
    return {
      id,
      outcome: failed ? failed.outcome : 'passed',
      durationMs: outcomes.reduce((sum, group) => sum + group.durationMs, 0),
    };
  });
  const ended = [tree.result.completedAt, host.result.completedAt];
  const passed =
    [tree, host].every((part) => part.passed && part.result.status === 'passed') &&
    groups.every((group) => group.outcome === 'passed');
  return {
    ...tree.result,
    groups,
    listGrowthApproved: host.result.listGrowthApproved,
    status: passed ? 'passed' : 'failed',
    startedAt: [tree.result.startedAt, host.result.startedAt].sort()[0] ?? tree.result.startedAt,
    completedAt: ended.includes(null) ? null : (ended.sort().at(-1) ?? null),
  };
}

/** The job of a mirror run's jobs (GitHub's job names) that runs `unit`: the DAG's name. */
export const mirrorJobName = (unit: Unit): string => CI_DAG[unit.job].name;

/**
 * The `ci/**` branches to delete: those whose commit is older than the TTL. A branch whose date
 * could not be read stays for the next sweep: it may be a running job's.
 */
export function staleBranches(
  branches: readonly { name: string; committedAt: Date | undefined }[],
  now: Date,
): string[] {
  return branches.flatMap((branch) =>
    branch.committedAt !== undefined && now.getTime() - branch.committedAt.getTime() > MIRROR_BRANCH_TTL_MS
      ? [branch.name]
      : [],
  );
}
