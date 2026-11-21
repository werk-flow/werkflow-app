// What the orchestrator decides about the CI mirror (scripts/ci/mirror-executor.ts): the branch of
// each job start, whether a result the mirror returned is this run's own, how Fast's two parts
// form its one result, and which branches are stale. It starts and reads nothing itself.
import { CI_DAG, type CiEvent, type CiJob } from './dag';
import type { CiResult, PlanIdentity } from './results';

/** The mirror's own workflow, the only one its pushed tree holds (scripts/ci/mirror-push.ts). */
export const MIRROR_WORKFLOW = '.github/workflows/ci-mirror.yml';
/** Where the pushed tree keeps the source's workflows, which tests and tools read (CI_WORKFLOWS_DIR). */
export const HELD_WORKFLOWS = '.github/held-workflows';
/** The most mirror jobs this host runs at once, every run together. */
export const MIRROR_JOB_CAP = 16;
/** A `ci/**` branch whose commit is older than this is swept. */
const MIRROR_BRANCH_TTL_MS = 24 * 60 * 60_000;

type Unit = { job: CiJob; shard: number | null };

/**
 * The branch of one job start: the source commit, the attempt and the job or shard. The workflow
 * runs the job its last segment names; a new attempt pushes new branches.
 */
export function mirrorBranch(commit: string, attempt: number, unit: Unit): string {
  return `ci/${commit}-a${attempt}/${unit.shard === null ? unit.job : `${unit.job}-${unit.shard}`}`;
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

/**
 * Fast's one result from its two parts: the mirror's (`tree`) and the host's (`host`, the groups
 * that read outside the tree). Each part must be this run's own (foreignResult) and hold exactly
 * its share of `planned`, and both must read the same list growth approval. It passes only when
 * both parts passed; its cost is the mirror machine's.
 */
export function joinFastParts(
  parts: { tree: CiResult; host: CiResult },
  planned: readonly string[],
): CiResult | { problem: string } {
  const { tree, host } = parts;
  if (tree.listGrowthApproved !== host.listGrowthApproved)
    return { problem: 'the two parts read different list growth approvals; run the job again' };
  const groups = [...tree.groups, ...host.groups];
  const ids = groups.map((group) => group.id);
  if (ids.length !== new Set(ids).size || [...ids].sort().join() !== [...planned].sort().join())
    return { problem: `the parts hold ${ids.join(', ')}, not the planned ${planned.join(', ')}` };
  const ended = [tree.completedAt, host.completedAt];
  return {
    ...tree,
    groups: planned.flatMap((id) => groups.filter((group) => group.id === id)),
    status: tree.status === 'passed' && host.status === 'passed' ? 'passed' : 'failed',
    startedAt: [tree.startedAt, host.startedAt].sort()[0] ?? tree.startedAt,
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
