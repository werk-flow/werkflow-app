// What the orchestrator decides about the CI mirror (lib/testing/ci/mirror.ts), the message it
// pushes (mirror-message.ts) and the mirror's workflow (ci/mirror/workflow.yml): a result counts only
// as this run's own, Fast's two parts form one result only when together they hold the plan, old
// branches go, and the workflow runs exactly the DAG's jobs on a push to `ci/**` with no secret.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { workflowsFolder } from '../ci-workflow';
import { planIdentityOf } from './check';
import { CI_DAG, CI_JOBS, CI_TOOLS, HOST_GROUPS, partGroups, partOf, partSteps } from './dag';
import { type ExpectedResult, foreignResult, joinFastParts, mirrorBranch, staleBranches } from './mirror';
import { mirrorMessage, mirrorVariables, parseMirrorMessage } from './mirror-message';
import type { CiResult, RunPlan } from './results';

const SOURCE = 'c'.repeat(40);
const TREE = 'a'.repeat(40);
const RUN_URL = 'https://ci.example/runs/7';
const PLAN: RunPlan = { jobs: ['plan', 'fast', 'check'], skips: {}, shards: [], outputs: {} };
const planResult: CiResult = {
  version: 1,
  job: 'plan',
  shard: null,
  event: 'pr',
  tree: TREE,
  commit: SOURCE,
  base: 'b'.repeat(40),
  status: 'passed',
  groups: [],
  planReason: 'Selection by diff',
  reusedFrom: null,
  listGrowthApproved: false,
  producer: 'ci-mirror',
  runUrl: RUN_URL,
  startedAt: '2026-11-21T10:00:00.000Z',
  completedAt: '2026-11-21T10:01:00.000Z',
  attempt: 1,
  plan: PLAN,
};
const identity = planIdentityOf(planResult, PLAN);
const expected: ExpectedResult = {
  job: 'sql',
  shard: null,
  event: 'pr',
  commit: SOURCE,
  tree: TREE,
  runUrl: RUN_URL,
  attempt: 1,
  producer: 'ci-mirror',
  planIdentity: identity,
};
const own = (overrides: Partial<CiResult> = {}): CiResult => ({
  ...planResult,
  job: 'sql',
  plan: undefined,
  groups: [{ id: 'sql:grants', outcome: 'passed', durationMs: 10 }],
  startedAt: '2026-11-21T10:02:00.000Z',
  completedAt: '2026-11-21T10:05:00.000Z',
  planIdentity: identity,
  ...overrides,
});

test("a mirror result counts only when it names this run's job, attempt, source commit and tree, producer and Plan", () => {
  expect(foreignResult(own(), expected)).toBeUndefined();
  const forged: [Partial<CiResult>, string][] = [
    [{ job: 'fast' }, 'job fast'],
    [{ shard: 2 }, 'shard 2'],
    [{ event: 'main' }, 'event main'],
    [{ commit: 'd'.repeat(40) }, 'commit'],
    // A mirror job that recorded the transformed tree, not the source's.
    [{ tree: 'e'.repeat(40) }, 'tree'],
    [{ runUrl: 'https://ci.example/runs/8' }, 'run'],
    [{ attempt: 2 }, 'attempt 2'],
    [{ producer: null }, 'producer none'],
    [{ planIdentity: { ...identity, digest: 'f'.repeat(64) } }, 'another Plan'],
    [{ planIdentity: undefined }, 'another Plan'],
    [{ status: 'running', completedAt: null }, 'no end'],
  ];
  for (const [change, named] of forged) expect(foreignResult(own(change), expected), named).toContain(named);
});

const FAST_PLANNED = ['static:lint', 'static:docs', 'static:migration-order', 'unit:all', 'step:build'];
const fastPart = (groups: string[], overrides: Partial<CiResult> = {}): CiResult =>
  own({
    job: 'fast',
    groups: groups.map((id) => ({ id, outcome: 'passed', durationMs: 1 })),
    ...overrides,
  });

test("Fast's two parts form one result in the plan's order, passed only when both passed", () => {
  const tree = fastPart(partGroups(FAST_PLANNED, 'tree'), { completedAt: '2026-11-21T10:09:00.000Z' });
  const host = fastPart(partGroups(FAST_PLANNED, 'host'), { startedAt: '2026-11-21T10:01:30.000Z' });
  const joined = joinFastParts({ tree, host }, FAST_PLANNED);
  if ('problem' in joined) throw new Error(joined.problem);
  expect(joined.groups.map((group) => group.id)).toEqual(FAST_PLANNED);
  expect(joined.status).toBe('passed');
  expect([joined.startedAt, joined.completedAt]).toEqual([
    '2026-11-21T10:01:30.000Z',
    '2026-11-21T10:09:00.000Z',
  ]);
  const failed = joinFastParts({ tree, host: { ...host, status: 'failed' } }, FAST_PLANNED);
  expect('problem' in failed ? failed.problem : failed.status).toBe('failed');
});

test("Fast's parts that miss or repeat a planned group, or read different approvals, form no result", () => {
  const tree = fastPart(partGroups(FAST_PLANNED, 'tree'));
  const host = fastPart(partGroups(FAST_PLANNED, 'host'));
  expect(joinFastParts({ tree, host: fastPart(['static:docs']) }, FAST_PLANNED)).toHaveProperty('problem');
  expect(joinFastParts({ tree, host: fastPart([...HOST_GROUPS, 'unit:all']) }, FAST_PLANNED)).toHaveProperty(
    'problem',
  );
  expect(joinFastParts({ tree, host: { ...host, listGrowthApproved: true } }, FAST_PLANNED)).toHaveProperty(
    'problem',
  );
});

test('on the mirror a job takes every step and group but those that read outside the tree, which its host part takes', () => {
  expect(partSteps('fast', 'tree')).toEqual(['install', 'stack-environment']);
  expect(partSteps('fast', 'host')).toEqual(['install', 'siblings', 'approval']);
  expect(partSteps('fast', undefined)).toEqual([...CI_DAG.fast.prepare]);
  for (const job of CI_JOBS.filter((name) => name !== 'fast'))
    expect(partSteps(job, 'tree'), job).toEqual([...CI_DAG[job].prepare]);
  expect(partGroups(FAST_PLANNED, 'tree')).toEqual(['static:lint', 'unit:all', 'step:build']);
  expect(partGroups(FAST_PLANNED, 'host')).toEqual(['static:docs', 'static:migration-order']);
  expect(() => partOf('everything')).toThrow('CI_PART everything is no part');
});

test('a branch names the source commit, the attempt and the job or shard, so each attempt pushes new branches', () => {
  expect(mirrorBranch(SOURCE, 2, { job: 'browser', shard: 3 })).toBe(`ci/${SOURCE}-a2/browser-3`);
  expect(mirrorBranch(SOURCE, 1, { job: 'fast', shard: null })).toBe(`ci/${SOURCE}-a1/fast`);
});

test('the sweep deletes only branches whose commit is older than a day', () => {
  const now = new Date('2026-11-22T12:00:00.000Z');
  expect(
    staleBranches(
      [
        { name: 'ci/old', committedAt: new Date('2026-11-21T11:59:00.000Z') },
        { name: 'ci/fresh', committedAt: new Date('2026-11-21T12:01:00.000Z') },
        { name: 'ci/unknown', committedAt: undefined },
      ],
      now,
    ),
  ).toEqual(['ci/old']);
});

test('the mirror message carries the run without a token, path or line break, and refuses anything else', () => {
  const variables = mirrorVariables({
    CI_EVENT: 'pr',
    CI_RUN_URL: RUN_URL,
    CI_RUN_ATTEMPT: '1',
    GH_TOKEN: 'secret',
    CI_RESULTS_DIR: '/host/runs/7',
    GITHUB_REPOSITORY: 'owner/name',
    CI_PR_HEAD_REF: 'refs/pull/7/head',
  });
  expect(variables).toEqual({ CI_EVENT: 'pr', CI_RUN_URL: RUN_URL, CI_RUN_ATTEMPT: '1' });
  expect(() => mirrorVariables({ CI_PRS: '7\nCI_PART=host' })).toThrow('line break');
  const run = {
    version: 1 as const,
    job: 'sql' as const,
    shard: null,
    source: { commit: SOURCE, tree: TREE },
    variables,
    plan: planResult,
  };
  expect(parseMirrorMessage(mirrorMessage(run))).toEqual(run);
  const text = mirrorMessage(run);
  expect(parseMirrorMessage(text.replace('"CI_EVENT"', '"GH_TOKEN"'))).toHaveProperty('problem');
  expect(parseMirrorMessage(text.replace('"sql"', '"deploy"'))).toHaveProperty('problem');
  expect(parseMirrorMessage(`Some commit\n\n${text}`)).toHaveProperty('problem');
});

// The mirror's workflow, as a tree it pushes holds it.
const workflow: unknown = Bun.YAML.parse(
  readFileSync(resolve(import.meta.dir, '../../../ci/mirror/workflow.yml'), 'utf8'),
);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const at = (...path: string[]): unknown =>
  path.reduce<unknown>((value, key) => (isRecord(value) ? value[key] : undefined), workflow);
const stepsOf = (job: string): Record<string, unknown>[] => {
  const steps = at('jobs', job, 'steps');
  return Array.isArray(steps) ? steps.filter(isRecord) : [];
};
const MIRROR_JOBS = CI_JOBS.filter((job) => job !== 'plan' && job !== 'check');

test('the mirror workflow runs only on a push to ci/**, reads the repository only and holds no secret', () => {
  expect(at('on')).toEqual({ push: { branches: ['ci/**'] } });
  expect(at('permissions')).toEqual({ contents: 'read' });
  expect(at('concurrency', 'cancel-in-progress')).toBe(true);
  expect(at('concurrency', 'group')).toContain('github.ref');
  const text = readFileSync(resolve(import.meta.dir, '../../../ci/mirror/workflow.yml'), 'utf8');
  expect(text).not.toMatch(/secrets\.|github\.token|GH_TOKEN|werk-?flow/i);
  for (const uses of [...text.matchAll(/uses: (\S+)/g)].map((match) => match[1]))
    expect(uses, 'a third-party action is pinned by its commit').toMatch(/@[0-9a-f]{40}$/);
  expect(at('env', 'CI_WORKFLOWS_DIR')).toBe('.github/held-workflows');
  expect(() => {
    process.env.CI_WORKFLOWS_DIR = '../elsewhere';
    try {
      workflowsFolder();
    } finally {
      delete process.env.CI_WORKFLOWS_DIR;
    }
  }).toThrow('no folder of .github');
});

test("the mirror workflow holds the DAG's jobs but Plan and Check, each with its name and timeout, picked by the branch", () => {
  const jobs = at('jobs');
  expect(isRecord(jobs) ? Object.keys(jobs).sort() : []).toEqual([...MIRROR_JOBS].sort());
  for (const job of MIRROR_JOBS) {
    expect(at('jobs', job, 'name'), job).toBe(CI_DAG[job].name);
    expect(at('jobs', job, 'timeout-minutes'), job).toBe(CI_DAG[job].timeoutMinutes);
    expect(at('jobs', job, 'runs-on'), job).toBe('ubuntu-24.04');
    const sharded = job === 'browser' || job === 'components';
    expect(at('jobs', job, 'if'), job).toBe(
      sharded ? `contains(github.ref_name, '/${job}-')` : `endsWith(github.ref_name, '/${job}')`,
    );
  }
});

test('each mirror job reads its run, then takes prepare.ts and job.ts for its job, and keeps its result one day', () => {
  for (const job of MIRROR_JOBS) {
    const runs = stepsOf(job).flatMap((step) => (typeof step.run === 'string' ? [step.run.trim()] : []));
    const calls = runs.filter((run) => run.startsWith('bun '));
    expect(calls, job).toEqual([
      `bun scripts/ci/mirror-job.ts ${job}`,
      `bun scripts/ci/prepare.ts for ${job}`,
      `bun scripts/ci/job.ts ${job}`,
    ]);
    const kept = stepsOf(job).find((step) => step.name === 'Keep the result');
    expect(isRecord(kept?.with) ? kept.with : undefined, job).toMatchObject({
      name: 'ci-result-${{ steps.run.outputs.unit }}',
      path: '${{ steps.run.outputs.result }}',
      'retention-days': 1,
    });
    for (const step of stepsOf(job).filter((each) => isRecord(each.with) && 'retention-days' in each.with))
      expect(isRecord(step.with) ? step.with['retention-days'] : undefined, job).toBe(1);
    const tools = stepsOf(job).flatMap((step) => (isRecord(step.with) ? [step.with] : []));
    expect(tools, job).toContainEqual({ 'bun-version': CI_TOOLS.bun });
    expect(tools, job).toContainEqual({ 'node-version': CI_TOOLS.nodeMajor });
    const stack = partSteps(job, 'tree').some((step) => step === 'stack' || step === 'stack-environment');
    expect(
      tools.some((entry) => entry.version === CI_TOOLS.supabaseCli),
      job,
    ).toBe(stack);
  }
});
