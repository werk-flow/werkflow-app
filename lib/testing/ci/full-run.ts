// When main needs a full run (owner decision D3, werk-flow/werkflow-planning#503), and what a full
// run found that no plan had selected. scripts/ci/full-run.ts asks the rule for any runner; GitHub's
// main-full-run.yml and the stand-in's scheduler both call it.
import { formatBerlinLocalDateTime } from '../../date-time/berlin';
import { isStep, plannedGroups } from './run-plan';
import type { CiResult } from './results';

/**
 * A full run on a commit of main, as GitHub's check runs or a runner's ledger report it: running,
 * or ended with a verdict. A run that died or was cancelled tested nothing, so no adapter reports it.
 */
export type FullRun = { commit: string; startedAt: Date; ended: boolean };

/** Daytime slots start from FIRST to LAST Berlin time, at most one per INTERVAL. */
export const FULL_RUN_SLOTS = { first: '06:00', last: '20:00', intervalMs: 3 * 60 * 60 * 1000 };
/**
 * A full run in a ledger without its final Check this long after its start has died with its
 * runner (its jobs' own timeouts and the midnight hold end a live one sooner), so it neither holds
 * the next one back nor counts as tested.
 */
const FULL_RUN_STALE_MS = 4 * 60 * 60 * 1000;

/** What landed on main since a full run's commit. */
export type Landed = {
  /** The changed files; empty when the tree is the full run's. */
  files: readonly string[];
  /** Why the changes run a tooling sample or every group (scripts/ci-plan.ts), or undefined. */
  tooling: () => string | undefined;
  /** Whether a file is documentation only (lib/testing/selection/fast-tier.ts, `isDocsFile`). */
  isDocs: (file: string) => boolean;
};

export type FullRunDecision = { run: boolean; reason: string };

/** The Berlin wall-clock time of an instant as `HH:MM`. */
const berlinClock = (at: Date): string => formatBerlinLocalDateTime(at).slice(11);

/**
 * Whether main's head needs a full run now. Requests coalesce: a head that has a full run, or a
 * full run still running, starts none. Nothing untested landed when the changes since the newest
 * full run are documentation only. A tooling input that landed (a sample or every group in its
 * plan) starts one at once, by day or night; otherwise a daytime slot starts one at most every
 * 3 hours. A diff that cannot be read counts as a tooling change.
 */
export function fullRunDue(input: {
  now: Date;
  /** main's commits from its head, newest first. */
  history: readonly string[];
  runs: readonly FullRun[];
  landedSince: (commit: string) => Landed | undefined;
}): FullRunDecision {
  const behind = input.history.findIndex((commit) => input.runs.some((run) => run.commit === commit));
  const commit = input.history[behind];
  if (commit === undefined)
    return { run: true, reason: `No full run on the last ${input.history.length} commits of main.` };
  if (behind === 0) return { run: false, reason: `${commit} already has a full run.` };
  const runs = input.runs.filter((run) => run.commit === commit);
  if (runs.some((run) => !run.ended))
    return {
      run: false,
      reason: `The full run on ${commit} is still running; a later request takes the newer commits.`,
    };
  const landed = input.landedSince(commit);
  if (landed && !landed.files.length)
    return { run: false, reason: `main's tree is still the one the full run on ${commit} tested.` };
  if (landed?.files.every(landed.isDocs))
    return { run: false, reason: `Only documentation landed since the full run on ${commit}.` };
  const clock = berlinClock(input.now);
  const started = Math.max(...runs.map((run) => run.startedAt.getTime()));
  const daytime = clock >= FULL_RUN_SLOTS.first && clock < FULL_RUN_SLOTS.last;
  const due = input.now.getTime() - started >= FULL_RUN_SLOTS.intervalMs;
  if (daytime && due)
    return { run: true, reason: `main moved ${behind} commits since the full run on ${commit}.` };
  const tooling = landed ? landed.tooling() : 'the diff since that run cannot be read';
  if (tooling)
    return { run: true, reason: `A tooling change landed since the full run on ${commit}: ${tooling}.` };
  return {
    run: false,
    reason: daytime
      ? `The full run on ${commit} started ${Math.floor((input.now.getTime() - started) / 60_000)} min ago; the next slot is at ${berlinClock(new Date(started + FULL_RUN_SLOTS.intervalMs))} Berlin time.`
      : `It is ${clock} in Berlin; daytime full runs start from ${FULL_RUN_SLOTS.first} to ${FULL_RUN_SLOTS.last}.`,
  };
}

/**
 * The full runs a runner's ledger holds: one per run of event `full`, started at its first
 * receipt, ended by its final Check, and left out once `FULL_RUN_STALE_MS` passed without one.
 */
export function fullRunsInLedger(ledger: readonly CiResult[], now: Date): FullRun[] {
  const runs = new Map<string, FullRun>();
  for (const receipt of ledger) {
    if (receipt.event !== 'full' || receipt.runUrl === null) continue;
    const startedAt = new Date(receipt.startedAt);
    const run = runs.get(receipt.runUrl) ?? { commit: receipt.commit, startedAt, ended: false };
    if (startedAt < run.startedAt) run.startedAt = startedAt;
    if (receipt.job === 'check' && receipt.status !== 'running') run.ended = true;
    runs.set(receipt.runUrl, run);
  }
  return [...runs.values()].filter(
    (run) => run.ended || now.getTime() - run.startedAt.getTime() < FULL_RUN_STALE_MS,
  );
}

/**
 * The groups CI selected on the trees that landed on main since the previous full run: each passed
 * integration or main plan's selection of a landed tree, before reuse (the fast tier's lists and the
 * browser shards still planned), and the groups of every integration or main browser shard that ran
 * on one, which hold the shards a plan reused. A pull request's own run runs no browser group
 * (owner decision D1), and a full run selects by no change, so neither counts.
 */
export function landedSelections(ledger: readonly CiResult[], landedTrees: ReadonlySet<string>): Set<string> {
  const selected = new Set<string>();
  for (const receipt of ledger) {
    if ((receipt.event !== 'integration' && receipt.event !== 'main') || !landedTrees.has(receipt.tree))
      continue;
    if (receipt.job === 'browser') for (const group of receipt.groups) selected.add(group.id);
    if (receipt.job !== 'plan' || receipt.status !== 'passed' || !receipt.plan) continue;
    const outputs = receipt.plan.outputs;
    for (const id of [
      ...plannedGroups('fast', outputs),
      ...plannedGroups('sql', outputs),
      ...plannedGroups('components', outputs, outputs.selected_components),
      ...receipt.plan.shards.flatMap((shard) => plannedGroups('browser', outputs, shard.groups)),
    ])
      selected.add(id);
  }
  return new Set([...selected].filter((id) => !isStep(id)));
}

/**
 * The groups a full run failed that `landedSelections` lacks: the breaks only the full run could
 * find. Their count per full run is what justifies its cadence, or retires it.
 */
export function unselectedFailures(failed: readonly string[], selected: ReadonlySet<string>): string[] {
  return [...new Set(failed)].filter((id) => !selected.has(id));
}
