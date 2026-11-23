// ci.yml schedules exactly the jobs of lib/testing/ci/dag.ts, with their names and needs, runs each
// body through scripts/ci/job.ts, and starts a job only when the plan runs it.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readWorkflow } from '../ci-workflow';
import { CI_DAG, CI_JOBS, CI_TOOLS, type PrepareStep, PREPARE_STEPS } from './dag';

const ci = readWorkflow('ci.yml');
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const asList = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : value === undefined ? [] : [value];

/** An `edited` event that kept the base: a title or body edit, which changes no tested input. */
const KEPT_BASE = "github.event.action == 'edited' && !github.event.changes.base";

test('ci.yml holds exactly the DAG jobs, with their names and needs', () => {
  const jobs = ci.at('jobs');
  if (!isRecord(jobs)) throw new Error('ci.yml has no jobs');
  expect(Object.keys(jobs).sort()).toEqual([...CI_JOBS].sort());
  for (const job of CI_JOBS) {
    const name = ci
      .text('jobs', job, 'name')
      .replace(' ${{ matrix.shard }}', '')
      .replace(`\${{ ${KEPT_BASE} && 'Ignored edit' || 'Check' }}`, 'Check');
    expect(name).toBe(CI_DAG[job].name);
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
  expect(ci.at('jobs', 'check', 'if')).toBe(
    "always() && (github.event.action != 'edited' || github.event.changes.base)",
  );
  const body = asList(ci.at('jobs', 'check', 'steps'))
    .filter(isRecord)
    .at(-1);
  expect(isRecord(body?.env) ? body.env.CI_NEEDS : undefined).toBe('${{ toJSON(needs) }}');
});

test('the events map to the DAG events, and a draft becoming ready starts no second run (D1)', () => {
  expect(ci.at('on', 'pull_request', 'types')).toEqual(['opened', 'synchronize', 'reopened', 'edited']);
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

// A stacked PR gets its run when GitHub retargets it to main (werk-flow/werkflow-planning#507). Any
// other edit must neither cancel the head's run nor leave a skipped `Check`, which counts as passed.
test('a retarget to main runs the PR; an edit that keeps the base runs no job, cancels nothing and reports no Check', () => {
  expect(ci.text('concurrency', 'group')).toEndWith(
    `\${{ ${KEPT_BASE} && format('-edit-{0}', github.run_id) || '' }}`,
  );
  expect(ci.at('jobs', 'plan', 'if')).toBe("github.event.action != 'edited' || github.event.changes.base");
  expect(ci.text('jobs', 'check', 'name')).toBe(`\${{ ${KEPT_BASE} && 'Ignored edit' || 'Check' }}`);
  // Every other job starts only from Plan's jobs, which a skipped Plan leaves empty.
  for (const job of CI_JOBS.filter((name) => name !== 'plan' && name !== 'check'))
    expect(ci.text('jobs', job, 'if')).toContain("fromJSON(needs.plan.outputs.jobs || '[]')");
});

const root = resolve(import.meta.dir, '../../..');
const PREPARE_CALL = /^bun scripts\/ci\/prepare\.ts ([a-z-]+)$/;

/** Whether a step's `if` can hold under these action inputs; clauses on anything else may hold. */
function mayRun(condition: unknown, inputs: Readonly<Record<string, string>>): boolean {
  if (typeof condition !== 'string') return true;
  return condition.split(' && ').every((clause) => {
    const match = /^inputs\.([a-z-]+) (==|!=) '([^']*)'$/.exec(clause.trim());
    if (!match) return true;
    const [, name = '', operator, value] = match;
    return (inputs[name] === value) === (operator === '==');
  });
}

/** The prepare.ts steps a list of workflow or action steps calls, composites expanded, in order. */
function prepareCalls(steps: unknown, inputs: Readonly<Record<string, string>> = {}): string[] {
  return asList(steps)
    .filter(isRecord)
    .filter((step) => mayRun(step.if, inputs))
    .flatMap((step) => {
      if (typeof step.run === 'string') {
        const call = PREPARE_CALL.exec(step.run.trim())?.[1];
        return call ? [call] : [];
      }
      const action =
        typeof step.uses === 'string' ? /^\.\/\.github\/actions\/([a-z-]+)$/.exec(step.uses)?.[1] : undefined;
      if (!action) return [];
      const composite: unknown = Bun.YAML.parse(
        readFileSync(resolve(root, '.github/actions', action, 'action.yml'), 'utf8'),
      );
      if (!isRecord(composite) || !isRecord(composite.runs)) return [];
      const declared = isRecord(composite.inputs) ? composite.inputs : {};
      const given = isRecord(step.with) ? step.with : {};
      const values = Object.fromEntries(
        Object.entries(declared).map(([name, input]) => [
          name,
          String(given[name] ?? (isRecord(input) ? (input.default ?? '') : '')),
        ]),
      );
      return prepareCalls(composite.runs.steps, values);
    });
}

// A runner off GitHub takes the same environment as ci.yml by construction: scripts/ci/run-commit.ts
// runs `prepare.ts for <job>`, which takes these lists (C1 of council round 2, werk-flow/werkflow-planning#503).
test('every ci.yml job calls exactly its prepare steps of the DAG, in order, through its actions', () => {
  for (const job of CI_JOBS)
    expect(prepareCalls(ci.at('jobs', job, 'steps')), job).toEqual([...CI_DAG[job].prepare]);
  const used = new Set<PrepareStep>(CI_JOBS.flatMap((job) => CI_DAG[job].prepare));
  expect(PREPARE_STEPS.filter((step) => !used.has(step))).toEqual([]);
});

test("every runner ends a job at ci.yml's timeout, and only the DAG's GitHub jobs get the token", () => {
  for (const job of CI_JOBS) {
    expect(ci.at('jobs', job, 'timeout-minutes'), job).toBe(CI_DAG[job].timeoutMinutes);
    const steps = asList(ci.at('jobs', job, 'steps')).filter(isRecord);
    const token = [ci.at('jobs', job, 'env'), ...steps.map((step) => step.env)].some(
      (env) => isRecord(env) && env.GH_TOKEN === '${{ github.token }}',
    );
    expect(token, job).toBe(CI_DAG[job].githubToken);
  }
});

test('prepare.ts pins the tools the actions install and key their caches by', () => {
  const action = (name: string) => readFileSync(resolve(root, '.github/actions', name, 'action.yml'), 'utf8');
  expect(action('setup')).toContain(`bun-version: ${CI_TOOLS.bun}\n`);
  expect(action('setup')).toContain(`node-version: ${CI_TOOLS.nodeMajor}\n`);
  expect(action('supabase-cli')).toContain(`version: ${CI_TOOLS.supabaseCli}\n`);
  expect(action('supabase-cli')).toContain(`key: supabase-cli-${CI_TOOLS.supabaseCli}-`);
  for (const key of ['supabase-environment-v1-', 'supabase-images-v3-ghcr-'])
    expect(action('local-stack')).toContain(`key: ${key}${CI_TOOLS.supabaseCli}-`);
});

// On Actions a job's process can read every other process of the job's user, so the sibling token
// lives only in one inline step that runs before any code of the tested checkout (its install
// scripts, its Bun configuration, its composites) and outside it. prepare.ts siblings then finds
// the clones in place and only reports a missing one.
test("on Actions the sibling token reaches only an inline clone step that runs before the checkout's code", () => {
  const holders: string[] = [];
  for (const job of CI_JOBS) {
    if (JSON.stringify(ci.at('jobs', job, 'env') ?? {}).includes('SIBLING_REPOSITORIES_TOKEN'))
      holders.push(`${job} (job)`);
    const steps = asList(ci.at('jobs', job, 'steps')).filter(isRecord);
    for (const [index, step] of steps.entries()) {
      if (!JSON.stringify(step.env ?? {}).includes('SIBLING_REPOSITORIES_TOKEN')) continue;
      holders.push(`${job} ${String(step.name)}`);
      const run = typeof step.run === 'string' ? step.run : '';
      expect(run, `${job}: ${String(step.name)}`).not.toMatch(/\bbun\b|\bnode\b|scripts\/|\.\//);
      expect(step['working-directory']).toBe('${{ runner.temp }}');
      // Only GitHub's own checkout runs before it.
      expect(
        steps.slice(0, index).map((earlier) => earlier.uses),
        `${job}: ${String(step.name)}`,
      ).toEqual([expect.stringMatching(/^actions\/checkout@[0-9a-f]{40}$/)]);
    }
  }
  expect(holders).toEqual(['fast Clone the sibling repositories']);
});
