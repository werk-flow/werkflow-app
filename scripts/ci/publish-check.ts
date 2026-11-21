import { join } from 'node:path';
import {
  CHECK_APP_CONFIG,
  checkRunOf,
  finishCheckRun,
  postCheckRun,
  queueCheckRunOf,
  queuedCheckRunOf,
  readCheckApp,
  readHandoff,
} from '../../lib/testing/ci/check-app';
import { CI_EVENTS } from '../../lib/testing/ci/dag';
import { resultFileName } from '../../lib/testing/ci/results';
import { repository } from './run';

// Posts a run's `Check`, a full run's `Full run / Check`, as a check run of the CI App
// (lib/testing/ci/check-app.ts).
// Usage: bun scripts/ci/publish-check.ts <start|finish|queue <success|failure>>
//   start   When the scheduler accepts the run or a rerun attempt, before it waits or any job
//           starts, and for a pull request also on `ready_for_review` itself: a queued check run,
//           which withdraws every earlier result of that check on the commit. A full run posts none.
//   finish  After `bun scripts/ci/job.ts check`: the run's verdict from check.json. It completes the
//           run's own start, and only while that start is the App's newest Check on the commit; it
//           never creates a Check. A run whose commit a newer run started on writes nothing and exits
//           1, and a newer start that lands meanwhile stays the newest, so an older fast-tier run that
//           ends late never replaces the integration run's queued Check. Check runs carry the run's
//           URL and attempt as `external_id`, by which finish finds its start. A full run, which has
//           no start, creates its `Full run / Check`.
//   queue   The merge queue's mark on a PR head, which the queue asks for through its --publisher
//           (scripts/ci/queue.ts): `Queue` passed right before it merges the PR, failed once that
//           merge happened or did not. It needs CI_RUN_URL, CI_COMMIT (the PR's head), CI_CHECK_APP_TOKEN
//           and GITHUB_REPOSITORY only.
// Run it from a trusted copy, never from the checkout under test: a checkout of `main` that no job
// writes, as an operating-system user that holds the App's key and token and that no job runs as.
// Each run's results directory is writable only by that run's jobs. Code under test then reaches
// neither the token nor this script; it can at most fail or pass its own run's Check, as on GitHub
// Actions. It reads plain environment variables only, each set by the scheduler:
//   CI_RUN_URL          The run's identity. Required.
//   CI_RUN_ATTEMPT      The run's attempt, 1 for the first; check.json must be of it. Required.
//   CI_EVENT            The run's event (lib/testing/ci/dag.ts); only `full` posts `Full run / Check`. Required.
//   CI_COMMIT           The commit the runner checked out for the run. Required.
//   CI_TREE             finish: that commit's tree; a passing check.json of another tree posts a
//                       failure. Required for finish.
//   CI_PR_HEAD_SHA      pr: the pull request's head when the runner checked out a merge commit on top
//                       of it, as for job.ts. The check run goes on that head.
//   CI_RESULTS_DIR      finish: the run's results directory; check.json is the verdict and must be of
//                       this run, attempt, event and commit. Required for finish.
//   CI_CHECK_APP_TOKEN  An installation token of the App that .github/scripts/check-app.json names,
//                       with `checks: write` only, minted from the App's key outside every checkout.
//                       Required. It reaches only the request's header: nothing prints it.
//   GITHUB_REPOSITORY   owner/name. Required.
// It exits 0 once GitHub holds the check run from the configured App. Without a configured App, or
// with a Check result of another run, attempt, event or commit, it posts nothing and exits 1.
const environment = process.env;
const mode = process.argv[2];

function fail(message: string): never {
  console.error(`::error title=Publish Check::${message}`);
  process.exit(1);
}

const queueState = mode === 'queue' ? process.argv[3] : undefined;
if (
  (mode !== 'start' && mode !== 'finish' && mode !== 'queue') ||
  (mode === 'queue' && queueState !== 'success' && queueState !== 'failure')
)
  fail('Usage: bun scripts/ci/publish-check.ts <start|finish|queue <success|failure>>');
const app = readCheckApp(join(repository, CHECK_APP_CONFIG));
if ('problem' in app) fail(app.problem);
if (app.appId === null) fail(`${CHECK_APP_CONFIG} names no CI App yet, so there is no App to post as.`);
const runUrl = environment.CI_RUN_URL;
const attempt = Number(environment.CI_RUN_ATTEMPT);
const event = CI_EVENTS.find((name) => name === environment.CI_EVENT);
const commit = environment.CI_COMMIT;
const directory = environment.CI_RESULTS_DIR;
const tree = environment.CI_TREE;
const token = environment.CI_CHECK_APP_TOKEN;
const repositoryName = environment.GITHUB_REPOSITORY;
if (mode === 'queue') {
  if (!runUrl || !commit || !token || !repositoryName)
    fail('CI_RUN_URL, CI_COMMIT (the PR head), CI_CHECK_APP_TOKEN and GITHUB_REPOSITORY are required.');
  const mark = queueCheckRunOf({ runUrl, head: commit, passed: queueState === 'success', now: new Date() });
  if ('problem' in mark) fail(`No check run is posted: ${mark.problem}.`);
  const posted = await postCheckRun({
    request: mark.request,
    appId: app.appId,
    token,
    repository: repositoryName,
    fetch,
  });
  if ('problem' in posted) fail(`The check run Queue was not posted: ${posted.problem}.`);
  console.info(`[ci] Queue on ${commit}: ${queueState}, check run ${posted.id} of App ${app.appId}`);
  process.exit(0);
}
if (
  !runUrl ||
  !Number.isSafeInteger(attempt) ||
  attempt < 1 ||
  !event ||
  !commit ||
  (mode === 'finish' && (!directory || !tree || !/^[0-9a-f]{40}$/.test(tree))) ||
  !token ||
  !repositoryName
)
  fail(
    `CI_RUN_URL, CI_RUN_ATTEMPT (1 or more), CI_EVENT (${CI_EVENTS.join('|')}), CI_COMMIT, CI_CHECK_APP_TOKEN, GITHUB_REPOSITORY and, to finish, CI_RESULTS_DIR and CI_TREE (a tree id) are required.`,
  );

const scheduled = { runUrl, attempt, event, commit, prHead: environment.CI_PR_HEAD_SHA || undefined };
const built =
  mode === 'start' || !directory || !tree
    ? queuedCheckRunOf(scheduled)
    : checkRunOf({
        check: readHandoff(join(directory, resultFileName('check', null))),
        plan: readHandoff(join(directory, resultFileName('plan', null))),
        tree,
        scheduled,
        now: new Date(),
      });
if (built === undefined) {
  console.info('[ci] A full run posts no queued check run; its Check posts at the end.');
  process.exit(0);
}
if ('problem' in built) fail(`No check run is posted: ${built.problem}.`);
const access = { request: built.request, appId: app.appId, token, repository: repositoryName, fetch };
const posted =
  mode === 'finish' ? await finishCheckRun({ ...access, scheduled }) : await postCheckRun(access);
if ('problem' in posted) fail(`The check run ${built.request.name} was not posted: ${posted.problem}.`);
console.info(
  `[ci] ${built.request.name} on ${built.request.head_sha}: ${built.request.status === 'completed' ? built.request.conclusion : 'queued'}, check run ${posted.id} of App ${app.appId}`,
);
