// ci.yml schedules exactly the jobs of lib/testing/ci/dag.ts, with their names and needs, runs each
// body through scripts/ci/job.ts, and starts a job only when the plan runs it.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readWorkflow } from '../ci-workflow';
import { CI_DAG, CI_JOBS } from './dag';

const ci = readWorkflow('ci.yml');
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const asList = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : value === undefined ? [] : [value];

test('ci.yml holds exactly the DAG jobs, with their names and needs', () => {
  const jobs = ci.at('jobs');
  if (!isRecord(jobs)) throw new Error('ci.yml has no jobs');
  expect(Object.keys(jobs).sort()).toEqual([...CI_JOBS].sort());
  for (const job of CI_JOBS) {
    const name = ci.text('jobs', job, 'name');
    expect(name.replace(' ${{ matrix.shard }}', '')).toBe(CI_DAG[job].name);
    expect(asList(ci.at('jobs', job, 'needs')).sort()).toEqual([...CI_DAG[job].needs].sort());
  }
});

test("each job body is one call of scripts/ci/job.ts, and a job starts only when the run's plan holds it", () => {
  for (const job of CI_JOBS) {
    const steps = asList(ci.at('jobs', job, 'steps')).filter(isRecord);
    const bodies = steps.filter((step) => step.uses === './.github/actions/ci-job');
    expect(bodies.map((step) => (isRecord(step.with) ? step.with.job : undefined))).toEqual([job]);
    if (job !== 'plan' && job !== 'check')
      expect(ci.text('jobs', job, 'if')).toContain(
        `contains(fromJSON(needs.plan.outputs.jobs || '[]'), '${job}')`,
      );
  }
});

test('Check runs after every other job, always, and passes it the scheduler results', () => {
  expect(ci.at('jobs', 'check', 'if')).toBe('always()');
  const body = asList(ci.at('jobs', 'check', 'steps'))
    .filter(isRecord)
    .at(-1);
  expect(isRecord(body?.env) ? body.env.CI_NEEDS : undefined).toBe('${{ toJSON(needs) }}');
});

test('the events map to the DAG events, and a draft becoming ready starts no second run (D1)', () => {
  expect(ci.at('on', 'pull_request', 'types')).toEqual(['opened', 'synchronize', 'reopened']);
  expect(ci.at('on', 'merge_group', 'types')).toEqual(['checks_requested']);
  const event = ci.text('env', 'CI_EVENT');
  for (const mapping of [
    "github.event_name == 'pull_request' && 'pr'",
    "github.event_name == 'merge_group' && 'integration'",
    "|| 'main'",
    "inputs.full || inputs.midnight_proof_minutes) && 'full'",
  ])
    expect(event).toContain(mapping);
  expect(ci.text('env', 'CI_BASE_SHA')).toContain(
    "github.event_name == 'merge_group' && github.event.merge_group.base_sha ||",
  );
});

test('a browser shard waits for the build by its need on Fast, never by polling the jobs API', () => {
  expect(ci.text('jobs', 'browser', 'if')).toContain("needs.fast.result == 'success'");
  expect(JSON.stringify(ci.at('jobs', 'browser'))).not.toContain('/actions/runs/');
});

// A hosted runner has no reviewed wall-clock baseline, so a timed shard would fail its wall-clock
// group whatever its steps do (lib/testing/selection/ci-plan.test.ts checks the other workflows).
test("a browser shard runs the plan's groups untimed, one worker", () => {
  const job = readFileSync(resolve(import.meta.dir, '../../../scripts/ci/job.ts'), 'utf8');
  const browser = job.slice(job.indexOf('async function browser('), job.indexOf('function check('));
  expect(browser).toContain("verify(verificationGroups(), ['--jobs', '1', '--untimed'])");
});

test("the browser and component jobs run one job per shard of the plan, each passing its shard's number", () => {
  for (const [job, output] of [
    ['browser', 'shards'],
    ['components', 'component_shards'],
  ] as const) {
    expect(ci.text('jobs', job, 'name')).toEndWith(' ${{ matrix.shard }}');
    expect(ci.at('jobs', job, 'strategy', 'matrix', 'include')).toBe(
      `\${{ fromJSON(needs.plan.outputs.${output} || '[]') }}`,
    );
    expect(ci.at('jobs', 'plan', 'outputs', output)).toBe(`\${{ steps.plan.outputs.${output} }}`);
    const body = asList(ci.at('jobs', job, 'steps'))
      .filter(isRecord)
      .find((step) => step.uses === './.github/actions/ci-job');
    expect(isRecord(body?.with) ? body.with.shard : undefined).toBe('${{ matrix.shard }}');
  }
});
