import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CI_JOBS } from '../../lib/testing/ci/dag';
import { parseMirrorMessage } from '../../lib/testing/ci/mirror-message';

// The first step of a CI mirror job (ci/mirror/workflow.yml), before any install: it reads the run
// from the commit's message (lib/testing/ci/mirror-message.ts), writes the run's Plan as plan.json
// into the job's results directory, and passes the run's variables to the later steps through
// GITHUB_ENV, as scripts/ci/job.ts takes them. The job's part is `tree`: the groups that read
// outside the tree run on the orchestrator's host. It imports nothing outside Node's modules and
// lib/testing/ci/dag.ts and mirror-message.ts.
// Usage: bun scripts/ci/mirror-job.ts <job>
// It reads GITHUB_ENV, GITHUB_OUTPUT and RUNNER_TEMP, as GitHub Actions sets them, and writes the
// step outputs `unit` (the job or shard, as the result's artifact is named) and `result` (its file).

function fail(message: string): never {
  console.error(`::error title=Mirror job::${message}`);
  process.exit(1);
}

const job = CI_JOBS.find((name) => name === process.argv[2]);
const { GITHUB_ENV: envFile, GITHUB_OUTPUT: outputFile, RUNNER_TEMP: temporary } = process.env;
if (!job || !envFile || !outputFile || !temporary)
  fail(`Usage on a mirror runner: bun scripts/ci/mirror-job.ts <${CI_JOBS.join('|')}>`);
const run = parseMirrorMessage(
  execFileSync('git', ['log', '-1', '--format=%B', 'HEAD'], { encoding: 'utf8' }),
);
if ('problem' in run) fail(`This commit runs no mirror job: ${run.problem}.`);
if (run.job !== job) fail(`This commit runs ${run.job}, not ${job}.`);
if ((job === 'browser' || job === 'components') !== (run.shard !== null))
  fail(`The run's shard ${run.shard ?? 'none'} does not fit ${job}.`);

const results = join(temporary, 'ci-results');
mkdirSync(results, { recursive: true });
writeFileSync(join(results, 'plan.json'), `${JSON.stringify(run.plan, null, 2)}\n`);
const unit = run.shard === null ? job : `${job}-${run.shard}`;
const variables: Record<string, string> = {
  ...run.variables,
  CI_RESULTS_DIR: results,
  CI_PART: 'tree',
  ...(run.shard === null ? {} : { CI_SHARD: String(run.shard) }),
};
appendFileSync(
  envFile,
  Object.entries(variables)
    .map(([name, value]) => `${name}=${value}\n`)
    .join(''),
);
appendFileSync(outputFile, `unit=${unit}\nresult=${join(results, `${unit}.json`)}\n`);
console.info(`[mirror] ${unit} of source commit ${run.source.commit}, tree ${run.source.tree}`);
