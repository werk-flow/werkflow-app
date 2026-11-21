import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { CHECK_APP_CONFIG, checkRunOf, postCheckRun, readCheckApp } from '../../lib/testing/ci/check-app';
import { readResult, resultFileName } from '../../lib/testing/ci/results';
import { repository } from './run';

// Posts a run's `Check`, a full run's `Full run / Check`, as a check run of the CI App
// (lib/testing/ci/check-app.ts). A runner off GitHub Actions runs it after `bun scripts/ci/job.ts check`,
// in the same checkout. It reads plain environment variables only:
//   CI_RESULTS_DIR      The run's results directory; check.json is the verdict. Required.
//   CI_RUN_URL          The run's identity; check.json must be of this run. Required.
//   CI_CHECK_APP_TOKEN  An installation token of the App that .github/scripts/check-app.json names,
//                       which the runner mints from the App's key outside the checkout. Required.
//                       It reaches only the request's header: nothing prints it and no child sees it.
//   GITHUB_REPOSITORY   owner/name. Required.
//   CI_PR_HEAD_SHA      pr: the pull request's head when the checkout is a merge commit on top of it,
//                       as for job.ts. The check run goes on that head.
//   GITHUB_API_URL      Optional; https://api.github.com by default.
// It exits 0 once GitHub holds the check run from the configured App. Without a configured App, or
// with a Check result of another run, it posts nothing and exits 1.
const environment = process.env;
const token = environment.CI_CHECK_APP_TOKEN;
delete environment.CI_CHECK_APP_TOKEN;

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
if (!directory || !runUrl || !token || !repositoryName)
  fail('CI_RESULTS_DIR, CI_RUN_URL, CI_CHECK_APP_TOKEN and GITHUB_REPOSITORY are required.');

const built = checkRunOf({
  check: readResult(join(directory, resultFileName('check', null))),
  plan: readResult(join(directory, resultFileName('plan', null))),
  runUrl,
  prHead: environment.CI_PR_HEAD_SHA || undefined,
  parents: (commit) =>
    execFileSync('git', ['rev-parse', `${commit}^@`], { cwd: repository, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean),
  now: new Date(),
});
if ('problem' in built) fail(`No check run is posted: ${built.problem}.`);
const posted = await postCheckRun({
  request: built.request,
  appId: app.appId,
  token,
  repository: repositoryName,
  apiUrl: environment.GITHUB_API_URL || 'https://api.github.com',
  fetch,
});
if ('problem' in posted) fail(`The check run ${built.request.name} was not posted: ${posted.problem}.`);
console.info(
  `[ci] ${built.request.name} on ${built.request.head_sha}: ${built.request.conclusion}, check run ${posted.id} of App ${app.appId}`,
);
