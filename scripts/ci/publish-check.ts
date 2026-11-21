import { join } from 'node:path';
import { CHECK_APP_CONFIG, checkRunOf, postCheckRun, readCheckApp } from '../../lib/testing/ci/check-app';
import { CI_EVENTS } from '../../lib/testing/ci/dag';
import { readResult, resultFileName } from '../../lib/testing/ci/results';
import { repository } from './run';

// Posts a run's `Check`, a full run's `Full run / Check`, as a check run of the CI App
// (lib/testing/ci/check-app.ts), after `bun scripts/ci/job.ts check`.
// Run it from a trusted copy, never from the checkout under test: a checkout of `main` that no job
// writes, as an operating-system user that holds the App's key and token and that no job runs as.
// Code under test then reaches neither the token nor this script; it can at most fail or pass its own
// run's Check, as on GitHub Actions. It reads plain environment variables only:
//   CI_RESULTS_DIR      The run's results directory; check.json is the verdict. Required.
//   CI_RUN_URL          The run's identity; check.json must be of this run. Required.
//   CI_EVENT            The scheduled run's event (lib/testing/ci/dag.ts); check.json must be of it,
//                       and only `full` posts `Full run / Check`. Required.
//   CI_COMMIT           The commit the runner checked out for the run; check.json must be of it. Required.
//   CI_PR_HEAD_SHA      pr: the pull request's head when the runner checked out a merge commit on top
//                       of it, as for job.ts. The check run goes on that head.
//   CI_CHECK_APP_TOKEN  An installation token of the App that .github/scripts/check-app.json names,
//                       with `checks: write` only, minted from the App's key outside every checkout.
//                       Required. It reaches only the request's header: nothing prints it.
//   GITHUB_REPOSITORY   owner/name. Required.
// It exits 0 once GitHub holds the check run from the configured App. Without a configured App, or
// with a Check result of another run, event or commit, it posts nothing and exits 1.
const environment = process.env;
const token = environment.CI_CHECK_APP_TOKEN;

function fail(message: string): never {
  console.error(`::error title=Publish Check::${message}`);
  process.exit(1);
}

const app = readCheckApp(join(repository, CHECK_APP_CONFIG));
if ('problem' in app) fail(app.problem);
if (app.appId === null) fail(`${CHECK_APP_CONFIG} names no CI App yet, so there is no App to post as.`);
const directory = environment.CI_RESULTS_DIR;
const runUrl = environment.CI_RUN_URL;
const repositoryName = environment.GITHUB_REPOSITORY;
const event = CI_EVENTS.find((name) => name === environment.CI_EVENT);
const commit = environment.CI_COMMIT;
if (!directory || !runUrl || !event || !commit || !token || !repositoryName)
  fail(
    `CI_RESULTS_DIR, CI_RUN_URL, CI_EVENT (${CI_EVENTS.join('|')}), CI_COMMIT, CI_CHECK_APP_TOKEN and GITHUB_REPOSITORY are required.`,
  );

const built = checkRunOf({
  check: readResult(join(directory, resultFileName('check', null))),
  plan: readResult(join(directory, resultFileName('plan', null))),
  scheduled: { runUrl, event, commit, prHead: environment.CI_PR_HEAD_SHA || undefined },
  now: new Date(),
});
if ('problem' in built) fail(`No check run is posted: ${built.problem}.`);
const posted = await postCheckRun({
  request: built.request,
  appId: app.appId,
  token,
  repository: repositoryName,
  fetch,
});
if ('problem' in posted) fail(`The check run ${built.request.name} was not posted: ${posted.problem}.`);
console.info(
  `[ci] ${built.request.name} on ${built.request.head_sha}: ${built.request.conclusion}, check run ${posted.id} of App ${app.appId}`,
);
