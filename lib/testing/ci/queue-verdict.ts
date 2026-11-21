// The verdict of one integration run of the merge queue (lib/testing/ci/queue.ts): only a CI
// runner's finished plan and Check of that run count, and a failure only with a job of the run that
// failed a group beyond its setup.
import type { Verdict } from './queue';
import type { CiResult, Ledger } from './results';
import { passedTree } from './reuse';

type Evidence = CiResult | { unreadable: string };

/**
 * What the integration run `run` left: its plan, its Check, every job result, the runner's ledger
 * when the queue reads one, and whether the runner exited 0.
 */
export type RunEvidence = {
  plan: Evidence;
  check: Evidence;
  results: readonly Evidence[];
  ledger: Ledger | undefined;
  runnerPassed: boolean;
};

/** The run the queue started: its commit, tree, base, URL and attempt (CI_RUN_ATTEMPT). */
type IntegrationRun = { commit: string; tree: string; base: string; runUrl: string; attempt: number };

const ofRun =
  (run: IntegrationRun) =>
  (result: CiResult): boolean =>
    result.event === 'integration' &&
    result.commit === run.commit &&
    result.tree === run.tree &&
    result.runUrl === run.runUrl;

/** Why the run's plan and Check cannot stand for the run, or undefined. */
function proofProblem(run: IntegrationRun, plan: Evidence, check: Evidence): string | undefined {
  if ('unreadable' in plan) return `no plan: ${plan.unreadable}`;
  if (plan.job !== 'plan' || !ofRun(run)(plan))
    return `the plan is of another run (${plan.runUrl}, tree ${plan.tree})`;
  if (plan.base !== run.base) return `the plan diffed against ${plan.base}, not the batch's base ${run.base}`;
  if (plan.status !== 'passed' || plan.completedAt === null || plan.producer === null)
    return 'the plan did not pass on a CI runner';
  if (plan.attempt !== run.attempt)
    return `the plan is of attempt ${plan.attempt ?? 'unknown'}, not the expected attempt ${run.attempt}`;
  if ('unreadable' in check) return `no Check result: ${check.unreadable}`;
  if (check.job !== 'check' || !ofRun(run)(check))
    return `the Check result is of another run (${check.runUrl}, tree ${check.tree})`;
  if (check.attempt !== run.attempt)
    return `the Check result is of attempt ${check.attempt ?? 'unknown'}, not the expected attempt ${run.attempt}`;
  // A rerun under the same run URL plans again, perhaps on another base: only the Check that
  // verified the run by this Plan stands for it.
  if (check.planStartedAt !== plan.startedAt)
    return `the Check verified the run by the Plan started ${check.planStartedAt ?? 'at no recorded time'}, not by this plan of ${plan.startedAt}`;
  if (check.status === 'running' || check.completedAt === null) return 'Check did not finish';
  if (check.producer === null) return 'Check ran outside a CI runner or on a changed checkout';
  return undefined;
}

/**
 * The steps that set a job up before any of its assertions run: a browser shard's build hand-off
 * and server start. Their failure alone is an environment question until a retry answers it.
 */
const SETUP_STEPS: ReadonlySet<string> = new Set(['step:server']);

/**
 * The verdict of the integration run `run`. Only a CI runner's finished plan of the batch's base
 * and Check of this run, its expected attempt and that plan count. A pass counts only when the
 * runner exited 0 too, and when the ledger, if the queue reads one, holds it as the pass of this landing (tree, base and the plan's work), so the push to main reuses it. A
 * failed Check counts against the batch only when a CI runner's finished job of this run failed a
 * group beyond its setup; otherwise the run proved nothing.
 */
export function verdictOf(run: IntegrationRun, evidence: RunEvidence): Verdict {
  const verdict = (kind: Verdict['kind'], detail: string): Verdict => ({ kind, runUrl: run.runUrl, detail });
  const { plan, check, ledger } = evidence;
  const problem = proofProblem(run, plan, check);
  if (problem || 'unreadable' in plan || 'unreadable' in check)
    return verdict('inconclusive', problem ?? 'no Check result');
  const landing = { tree: run.tree, base: run.base, work: plan.plan?.work ?? [] };
  // A Check that wrote a pass and then failed leaves the pass behind when the runner could not set
  // it failed (lib/testing/ci/run-commit.ts): only the runner's exit tells.
  if (check.status === 'passed' && !evidence.runnerPassed)
    return verdict('inconclusive', 'Check wrote a pass, but the runner did not exit 0');
  if (check.status === 'passed')
    return ledger === undefined || passedTree(ledger, landing, () => undefined) === run.runUrl
      ? verdict('passed', 'Check passed')
      : verdict('inconclusive', "Check passed, but the ledger does not hold the run as its landing's pass");
  // Only a job that ran under this Plan and attempt names a failure.
  const failed = evidence.results.flatMap((result) =>
    'unreadable' in result ||
    !ofRun(run)(result) ||
    result.producer === null ||
    result.completedAt === null ||
    result.attempt !== run.attempt ||
    result.planIdentity?.startedAt !== plan.startedAt
      ? []
      : result.groups.filter((group) => group.outcome === 'failed').map((group) => group.id),
  );
  const named = [...new Set(failed)];
  if (named.length && named.every((id) => SETUP_STEPS.has(id)))
    return verdict(
      'inconclusive',
      `only the setup failed (${named.join(', ')}), before any assertion ran: an environment failure until a retry shows otherwise`,
    );
  return named.length
    ? verdict('failed', `failed: ${named.join(', ')}`)
    : verdict(
        'inconclusive',
        'Check failed, but no CI job of the run failed a group: a job was cancelled, lost its result or failed before its groups ran',
      );
}
