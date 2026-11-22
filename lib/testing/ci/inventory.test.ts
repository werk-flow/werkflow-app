// The inventory is CI's whole list (lib/testing/ci/inventory.ts): every workflow job is an item's
// source, the CI run itself or named as no CI work, every group kind has a job, every piece of
// work the conductor starts is an item, each schedule's trigger is the one that dispatches it, and
// each health check says whether it needs a credential.
import { expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from '../../zod';
import { readWorkflow, workflowsFolder } from '../ci-workflow';
import { getTestGroups } from '../selection/test-groups';
import { CI_DAG, CI_EVENTS, CI_JOBS } from './dag';
import {
  GROUP_KIND_JOBS,
  HEALTH_CHECKS,
  INVENTORY_KEYS,
  type InventoryKey,
  OUTSIDE_INVENTORY,
  SCHEDULE_NAMES,
  type ScheduleTrigger,
  SCHEDULES,
} from './inventory';
import { CLOCK_WORK_NAMES, type ClockWorkName } from './schedule';

const repositoryRoot = resolve(import.meta.dir, '../../..');

const workflowJobs = (file: string): string[] => {
  const jobs = readWorkflow(file).at('jobs');
  return typeof jobs === 'object' && jobs !== null ? Object.keys(jobs) : [];
};

test('every workflow job is a source of an item, the CI run itself, or named as no CI work', () => {
  const sources = new Set<string>(Object.values(SCHEDULES).flatMap((item) => item.sources));
  const files = readdirSync(join(repositoryRoot, workflowsFolder())).filter((file) => file.endsWith('.yml'));
  const unaccounted = files.flatMap((file) =>
    file === 'ci.yml'
      ? []
      : workflowJobs(file)
          .map((job) => `${file}#${job}`)
          .filter((key) => !sources.has(key) && !(key in OUTSIDE_INVENTORY)),
  );
  expect(unaccounted).toEqual([]);
  // ci.yml is the run of every event: its jobs are the DAG's.
  expect(workflowJobs('ci.yml').toSorted()).toEqual([...CI_JOBS].sort());
});

test('every source and every job named as no CI work exists', () => {
  const named = [
    ...Object.values(SCHEDULES).flatMap((item) => item.sources),
    ...Object.keys(OUTSIDE_INVENTORY),
  ];
  const missing = named.filter((source) => {
    const [file = '', job] = source.split('#');
    if (job === undefined) return !existsSync(join(repositoryRoot, file));
    return !workflowJobs(file).includes(job);
  });
  expect(missing).toEqual([]);
});

test('every registered test group has a kind whose job CI runs, or the reason CI never does', () => {
  const groups = getTestGroups(repositoryRoot);
  expect(groups.length).toBeGreaterThan(0);
  for (const group of groups) {
    const carrier = GROUP_KIND_JOBS[group.kind];
    if (typeof carrier === 'string') expect(CI_DAG[carrier].events.length, group.id).toBeGreaterThan(0);
    else expect(carrier.outside, group.id).not.toBe('');
  }
});

test('the inventory holds every job, every kind of run and every schedule once', () => {
  expect(new Set(INVENTORY_KEYS).size).toBe(INVENTORY_KEYS.length);
  expect(INVENTORY_KEYS.length).toBe(CI_JOBS.length + CI_EVENTS.length + Object.keys(SCHEDULES).length);
});

test('every piece of work the conductor starts is an item of the inventory, fired by its clock', () => {
  // A new clock work in schedule.ts fails the type check here until it names its item.
  const started: Record<ClockWorkName | 'full' | 'midnight', InventoryKey> = {
    release: 'schedule:release-candidate',
    nightly: 'schedule:nightly',
    full: 'schedule:main-full-run',
    midnight: 'job:midnight',
  };
  for (const key of Object.values(started)) expect(INVENTORY_KEYS).toContain(key);
  // Each of the conductor's clocks fires exactly the item that names it.
  const clocks = Object.fromEntries(
    SCHEDULE_NAMES.flatMap((name) => {
      const trigger: ScheduleTrigger = SCHEDULES[name].trigger;
      return trigger.on === 'time' && trigger.conductor ? [[trigger.conductor, `schedule:${name}`]] : [];
    }),
  );
  expect(clocks).toEqual({
    ...Object.fromEntries(CLOCK_WORK_NAMES.map((name) => [name, started[name]])),
    'full-run': started.full,
  });
});

/** The workflow files of an item's sources. */
const workflowsOf = (sources: readonly string[]): string[] =>
  sources.flatMap((source) => {
    const [file = '', job] = source.split('#');
    return job === undefined ? [] : [file];
  });

const cronListSchema = z
  .array(z.object({ cron: z.string(), timezone: z.string().optional() }))
  .optional()
  .default([]);

test("each timed schedule's workflow cron is a cron of that workflow, and every cron of a source workflow fires an item", () => {
  const declared = new Set<string>();
  const sourceWorkflows = new Set<string>();
  for (const name of SCHEDULE_NAMES) {
    const { sources } = SCHEDULES[name];
    const trigger: ScheduleTrigger = SCHEDULES[name].trigger;
    for (const file of workflowsOf(sources)) sourceWorkflows.add(file);
    if (trigger.on !== 'time' || !trigger.workflow) continue;
    const { workflow, cron } = trigger.workflow;
    expect(workflowsOf(sources), `${name} is fired by a workflow it runs`).toContain(workflow);
    declared.add(`${workflow} ${cron} ${trigger.workflow.timezone ?? 'UTC'}`);
  }
  // A cron removed from a workflow, or one added there, fails here: the trigger the inventory names
  // must be the one that dispatches the item.
  const actual = new Set(
    [...sourceWorkflows].flatMap((file) =>
      cronListSchema
        .parse(readWorkflow(file).at('on', 'schedule'))
        .map(({ cron, timezone }) => `${file} ${cron} ${timezone ?? 'UTC'}`),
    ),
  );
  expect([...actual].toSorted()).toEqual([...declared].sort());
});

test('a timed schedule only the conductor fires has no cron of its own, so its workflow waits for a dispatch', () => {
  for (const name of SCHEDULE_NAMES) {
    const { sources } = SCHEDULES[name];
    const trigger: ScheduleTrigger = SCHEDULES[name].trigger;
    if (trigger.on !== 'time' || trigger.workflow) continue;
    for (const file of workflowsOf(sources)) {
      const on = readWorkflow(file).at('on');
      expect(typeof on === 'object' && on !== null ? Object.keys(on) : [], `${name}: ${file}`).toEqual([
        'workflow_dispatch',
      ]);
    }
  }
});

const eventSchema = z.strictObject({
  workflows: z.array(z.string()).readonly().optional(),
  branches: z.array(z.string()).readonly(),
  types: z.array(z.string()).readonly(),
});

test("each event schedule's GitHub event is the one its workflow listens to, and the only one", () => {
  for (const name of SCHEDULE_NAMES) {
    const { sources } = SCHEDULES[name];
    const trigger: ScheduleTrigger = SCHEDULES[name].trigger;
    if (trigger.on !== 'event') continue;
    const { workflow, on, ...filters } = trigger.github;
    expect(workflowsOf(sources), `${name} is dispatched by a workflow it runs`).toContain(workflow);
    const listens = readWorkflow(workflow).at('on');
    expect(typeof listens === 'object' && listens !== null ? Object.keys(listens) : [], name).toEqual([on]);
    expect(eventSchema.parse(readWorkflow(workflow).at('on', on)), name).toEqual(filters);
  }
});

/** The secrets a job of health.yml or one of its steps maps into the environment. */
const secretNames = (env: unknown): string[] =>
  Object.entries(z.record(z.string(), z.string()).optional().default({}).parse(env)).flatMap(
    ([name, value]) => (value.includes('secrets.') ? [name] : []),
  );

const stepSchema = z.object({
  id: z.string().optional(),
  run: z.string().optional(),
  env: z.unknown().optional(),
});

test('each health check is listed with its job, whether it needs a credential, and where it runs', () => {
  const health = readWorkflow('health.yml');
  // health.yml's proof runs name every check by its id.
  const options = z
    .array(z.string())
    .parse(health.at('on', 'workflow_dispatch', 'inputs', 'break_check', 'options'));
  expect(Object.keys(HEALTH_CHECKS).toSorted()).toEqual(options.filter((id) => id !== 'none').sort());
  for (const [id, check] of Object.entries(HEALTH_CHECKS)) {
    const steps = z.array(stepSchema).parse(health.at('jobs', check.job, 'steps'));
    const step = steps.find(
      (candidate) => candidate.id === id || candidate.run?.includes(`.github/scripts/${id}.sh`),
    );
    if (!step?.run) throw new Error(`health.yml#${check.job} has no step of ${id}.`);
    const script = /\.github\/scripts\/[\w-]+\.sh/.exec(step.run)?.[0];
    const reads = `${step.run}\n${script ? readFileSync(join(repositoryRoot, script), 'utf8') : ''}`;
    const secrets = [...secretNames(health.at('jobs', check.job, 'env')), ...secretNames(step.env)];
    expect(
      secrets.some((secret) => new RegExp(`\\b${secret}\\b`).test(reads)),
      `${id} reads a secret`,
    ).toBe(check.key === 'keyed');
    // A key-free check is CI work, run by an item whose sources hold its job; a keyed one stays on GitHub.
    if (check.runs !== 'github')
      expect(SCHEDULES[check.runs].sources, id).toContain(`health.yml#${check.job}`);
  }
});
