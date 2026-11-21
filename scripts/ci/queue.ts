// One tick of the batching merge queue (owner decision D2; lib/testing/ci/queue.ts decides,
// scripts/ci/queue-adapter.ts acts). A CI runner calls it in a loop, one tick at a time, from a
// clean clone of werkflow-app whose `gh` may merge PRs and set commit statuses.
//
// Usage: bun scripts/ci/queue.ts --runner <executable> --work-dir <dir> --run-url-base <url>
//                                [--ledger <file>] [--max-batch <1-4>] [--dry-run [--prs <n,...>]]
//   --runner        Runs one integration run of a commit, every job of its plan through
//                   `bun scripts/ci/job.ts`, in checkouts of that commit, ending with `job.ts check`.
//                   It takes the runner's own variables (CI_PRODUCER, CI_LEDGER) and these, the same
//                   for every job of the run: CI_EVENT=integration, CI_BASE_SHA, CI_RUN_URL,
//                   CI_RESULTS_DIR, CI_PRS, SHRINK_ONLY_GROWTH_APPROVED. The commit is
//                   CI_QUEUE_COMMIT; fetch it with
//                   `git fetch "$CI_QUEUE_REPOSITORY" "refs/ci-queue/runs/$CI_QUEUE_COMMIT"`.
//                   Its exit code decides nothing: the queue reads the run's results.
//   --work-dir      Holds one results directory per run.
//   --run-url-base  Each run's CI_RUN_URL is <base>/<time>-<commit>.
//   --ledger        The runner's CI_LEDGER, read only. A pass counts only when the ledger holds it as
//                   its tree's pass, and a batch's first PR is named only on a main tree it proves
//                   green. Without it neither proof exists: a failure of the first PR needs a person.
//   --max-batch     The most PRs in a batch, default 4. 1 while the ruleset requires up-to-date branches.
//   --dry-run       Builds, tests and decides, but never sets a status, merges, comments or
//                   turns auto-merge off. --prs names the PRs to rehearse with, in order.
// Exit 0: the tick decided (landed, named a failing PR, nothing queued, superseded, stale base).
// Exit 2: it needs a person: a run without a verdict, a first PR failing on an unproven main, or a
// landing that broke. Stop the loop.
import { closeSync, mkdirSync, openSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { MAX_BATCH, needsAttention, runQueueTick } from '../../lib/testing/ci/queue';
import { createQueueAdapter } from './queue-adapter';
import { repository } from './run';

const { values } = parseArgs({
  options: {
    runner: { type: 'string' },
    'work-dir': { type: 'string' },
    'run-url-base': { type: 'string' },
    'max-batch': { type: 'string', default: String(MAX_BATCH) },
    'dry-run': { type: 'boolean', default: false },
    prs: { type: 'string' },
    ledger: { type: 'string' },
  },
});
const maxBatch = Number(values['max-batch']);
const only = values.prs?.split(',').map(Number);
if (!values.runner || !values['work-dir'] || !values['run-url-base'])
  throw new Error('The queue needs --runner, --work-dir and --run-url-base.');
if (!Number.isInteger(maxBatch) || maxBatch < 1 || maxBatch > MAX_BATCH)
  throw new Error(`--max-batch takes 1 to ${MAX_BATCH}.`);
if (only && (!values['dry-run'] || only.some((number) => !Number.isInteger(number) || number < 1)))
  throw new Error('--prs takes PR numbers, and only with --dry-run: a live tick lands only queued PRs.');

const workDir = resolve(values['work-dir']);
mkdirSync(workDir, { recursive: true });
// One tick at a time: a second tick would test against a main the first is about to move.
const lock = join(workDir, 'queue.lock');
let held: number;
try {
  held = openSync(lock, 'wx');
} catch {
  console.error(`[queue] ${lock} exists: another tick runs, or one died. Remove it once no tick runs.`);
  process.exit(2);
}
try {
  const adapter = createQueueAdapter({
    repository,
    runner: resolve(values.runner),
    workDir,
    runUrlBase: values['run-url-base'],
    ...(values.ledger ? { ledger: resolve(values.ledger) } : {}),
  });
  const outcome = await runQueueTick(adapter, {
    maxBatch,
    dryRun: values['dry-run'],
    ...(only ? { only } : {}),
  });
  console.info(`[queue] ${JSON.stringify(outcome)}`);
  for (const stop of outcome.stops) console.info(`[queue] ${stop.kind}: ${stop.detail}`);
  const landing = outcome.landing.map((number) => `#${number}`).join(', ') || 'nothing';
  console.info(`[queue] ${outcome.dryRun ? 'would land' : 'landed'} ${landing}`);
  process.exitCode = needsAttention(outcome) ? 2 : 0;
} finally {
  closeSync(held);
  rmSync(lock);
}
