// One tick of the batching merge queue (owner decision D2; lib/testing/ci/queue.ts decides,
// scripts/ci/queue-adapter.ts acts). A CI runner calls it in a loop, one tick at a time, from a
// clean clone of werkflow-app on main's head whose `gh` may merge PRs, update their branches and
// set commit statuses. While the ruleset requires up-to-date branches, a live tick ends by
// updating the oldest queued PR GitHub reports `BEHIND` with main (GitHub's update-branch, only at the
// head the queue saw green), one at a time; no other PR is freshened.
//
// Usage: bun scripts/ci/queue.ts --runner <executable> --work-dir <dir> --run-url-base <url>
//                                [--ledger <file>] [--publisher <executable>] [--max-batch <1-4>]
//                                [--dry-run [--prs <n,...>]]
//   --runner        Runs one integration run of a commit, every job of its plan through
//                   `bun scripts/ci/job.ts`, in checkouts of that commit, ending with `job.ts check`.
//                   It takes the runner's own variables (CI_PRODUCER, CI_LEDGER) and these, the same
//                   for every job of the run: CI_EVENT=integration, CI_BASE_SHA, CI_RUN_URL,
//                   CI_RESULTS_DIR, CI_PRS, SHRINK_ONLY_GROWTH_APPROVED. The commit is
//                   CI_QUEUE_COMMIT; fetch it with
//                   `git fetch "$CI_QUEUE_REPOSITORY" "refs/ci-queue/runs/$CI_QUEUE_COMMIT"`.
//                   Its exit code decides nothing: the queue reads the run's results. It posts no
//                   `Check`: its commit exists only in the queue's clone, and the queue's verdict
//                   reaches GitHub as `Queue`. Held browser shards start once, as for any held run:
//                   from the orchestrator's `bun scripts/ci/schedule.ts due --run "$CI_RESULTS_DIR"`;
//                   the runner waits for them and never starts them itself. A queue run is never a
//                   `--pr-run`: the queue cancels its own superseded entries.
//   --work-dir      Holds one results directory per run, and the queue's state between ticks
//                   (queue-state.json): the `Queue` success it is about to post, saved before it
//                   posts it, and cleared once it was withdrawn after the merge or its failure. A
//                   tick starts by withdrawing a saved mark, merged or not. A withdrawal that fails
//                   freezes the queue. It also records a run without a verdict, which the next tick
//                   retries once.
//   --run-url-base  Each run's CI_RUN_URL is <base>/<time>-<commit>.
//   --ledger        The runner's CI_LEDGER, read only. With it, a pass counts only when the ledger
//                   holds it as its tree's pass, so main's push reuses it; without it, the run's own
//                   passed Check is the verdict. A batch's first PR is named only on a main tree the
//                   ledger proves green, so without a ledger a failure of the first PR needs a person.
//   --publisher     Required once .github/scripts/check-app.json names the CI App: an executable that
//                   runs `bun scripts/ci/publish-check.ts queue <success|failure>` from the trusted
//                   copy as the App's user, with the CI_RUN_URL and CI_COMMIT the queue passes.
//                   `Queue` is then the App's check run, and a PR's `Check` only the App's. Before the
//                   App exists, `Queue` is a commit status of `gh` and `Check` the commit status.
//   --max-batch     The most PRs in a batch, default 4. 1 while the ruleset requires up-to-date branches.
//   --dry-run       Builds, tests and decides, but never sets a status, merges, comments or
//                   turns auto-merge off. --prs names the PRs to rehearse with, in order.
// Exit 0: the tick decided (landed, named a failing PR, nothing queued, superseded, stale base, a
// landing that stopped after part of the tested prefix: main's own run of that commit runs its jobs,
// a PR left for a later tick because its migration would land out of order after another of the
// batch, or a first run without a verdict, a browser setup failure alone included, which the next
// tick retries: `retry`). A red batch whose shorter prefixes all passed runs once more before its
// last PR is named; a pass of that rerun is a contradiction for a person.
// Exit 2: it needs a person: the same work's second run without a verdict, a contradicted tree, a
// first PR failing on an unproven main, a landing that broke (a failed read between merges
// included), a frozen queue, a refused option or configuration, or an error. Stop the loop. A tick
// that exits 2 after a merge still moved main: it logs a `partial` stop with the last merge it
// confirmed, the merge commit GitHub reports, or the head main moved to when that was not the
// tested tree, or says a merge may have landed when GitHub could not answer. After any landing or
// `partial` stop the runner starts main's run of main's head, whatever the exit, with CI_BASE_SHA
// the tick's `base` (main before the batch): that run reuses the batch's pass only for the landing
// it tested. A frozen queue lands nothing until a person confirms on GitHub that the named head's
// newest `Queue` is no success, merged or not, then deletes queue-state.json.
import { closeSync, mkdirSync, openSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { CHECK_APP_CONFIG, readCheckApp } from '../../lib/testing/ci/check-app';
import { MAX_BATCH, needsAttention, runQueueTick } from '../../lib/testing/ci/queue';
import { createQueueAdapter, QUEUE_STATE_FILE } from './queue-adapter';
import { repository } from './run';

/** Refuses before the tick changes anything, with the exit that stops the loop. */
function refuse(problem: string): never {
  console.error(`[queue] ${problem}`);
  process.exit(2);
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const { values } = (() => {
  try {
    return parseArgs({
      options: {
        runner: { type: 'string' },
        'work-dir': { type: 'string' },
        'run-url-base': { type: 'string' },
        'max-batch': { type: 'string', default: String(MAX_BATCH) },
        'dry-run': { type: 'boolean', default: false },
        prs: { type: 'string' },
        ledger: { type: 'string' },
        publisher: { type: 'string' },
      },
    });
  } catch (error) {
    return refuse(message(error));
  }
})();
const maxBatch = Number(values['max-batch']);
const numbers = values.prs?.split(',');
if (!values.runner || !values['work-dir'] || !values['run-url-base'])
  refuse('The queue needs --runner, --work-dir and --run-url-base.');
// Decimal digits only: Number() reads `0x10` as 16 and `1e1` as 10.
if (!/^[1-9][0-9]*$/.test(values['max-batch']) || maxBatch > MAX_BATCH)
  refuse(`--max-batch takes 1 to ${MAX_BATCH}.`);
if (numbers && (!values['dry-run'] || numbers.some((number) => !/^[1-9][0-9]{0,8}$/.test(number))))
  refuse('--prs takes PR numbers, and only with --dry-run: a live tick lands only queued PRs.');
const only = numbers?.map(Number);

// The App this clone's main names: the tick reads `Check` and posts `Queue` as that App, or as before.
const app = readCheckApp(join(repository, CHECK_APP_CONFIG));
if ('problem' in app) refuse(app.problem);
if (app.appId !== null && !values.publisher)
  refuse(`${CHECK_APP_CONFIG} names CI App ${app.appId}: the queue needs --publisher to post Queue as it.`);

const workDir = resolve(values['work-dir']);
// One tick at a time: a second tick would test against a main the first is about to move. The lock
// guards this work directory only, so one queue loop runs per repository; a tick that lands onto a
// main another moved stops after that merge (landing-failed).
const lock = join(workDir, 'queue.lock');
let held: number;
try {
  mkdirSync(workDir, { recursive: true });
  held = openSync(lock, 'wx');
} catch (error) {
  refuse(
    error instanceof Error && 'code' in error && error.code === 'EEXIST'
      ? `${lock} exists: another tick runs, or one died. Remove it once no tick runs.`
      : `${lock} could not be created: ${message(error)}`,
  );
}
try {
  const adapter = createQueueAdapter({
    repository,
    runner: resolve(values.runner),
    workDir,
    runUrlBase: values['run-url-base'],
    ...(values.ledger ? { ledger: resolve(values.ledger) } : {}),
    appId: app.appId,
    ...(values.publisher ? { publisher: resolve(values.publisher) } : {}),
  });
  const outcome = await runQueueTick(adapter, {
    maxBatch,
    dryRun: values['dry-run'],
    ...(only ? { only } : {}),
  });
  console.info(`[queue] ${JSON.stringify(outcome)}`);
  for (const stop of outcome.stops) console.info(`[queue] ${stop.kind}: ${stop.detail}`);
  if (outcome.stops.some((stop) => stop.kind === 'frozen'))
    console.error(
      `[queue] The queue is frozen. Once GitHub shows that the head's newest Queue is no success, merged or not, delete ${join(workDir, QUEUE_STATE_FILE)} and restart the loop.`,
    );
  const landing = outcome.landing.map((number) => `#${number}`).join(', ') || 'nothing';
  console.info(`[queue] ${outcome.dryRun ? 'would land' : 'landed'} ${landing}`);
  process.exitCode = needsAttention(outcome) ? 2 : 0;
} catch (error) {
  console.error(`[queue] the tick failed: ${error instanceof Error ? error.stack : String(error)}`);
  process.exitCode = 2;
} finally {
  closeSync(held);
  rmSync(lock);
}
