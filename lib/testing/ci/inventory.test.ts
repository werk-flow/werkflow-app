// The inventory is CI's whole list (lib/testing/ci/inventory.ts): every workflow job is an item's
// source, the CI run itself or named as no CI work, every group kind has a job, and every piece of
// work the conductor starts is an item.
import { expect, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readWorkflow, workflowsFolder } from '../ci-workflow';
import { getTestGroups } from '../selection/test-groups';
import { CI_DAG, CI_EVENTS, CI_JOBS } from './dag';
import {
  GROUP_KIND_JOBS,
  INVENTORY_KEYS,
  type InventoryKey,
  OUTSIDE_INVENTORY,
  SCHEDULES,
} from './inventory';
import type { ClockWorkName } from './schedule';

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

test('every piece of work the conductor starts is an item of the inventory', () => {
  // A new clock work in schedule.ts fails the type check here until it names its item.
  const started: Record<ClockWorkName | 'full' | 'midnight', InventoryKey> = {
    release: 'schedule:release-candidate',
    nightly: 'schedule:nightly',
    full: 'schedule:main-full-run',
    midnight: 'job:midnight',
  };
  for (const key of Object.values(started)) expect(INVENTORY_KEYS).toContain(key);
});

test('each event schedule waits for its own event', () => {
  const events = Object.values(SCHEDULES).flatMap((item) =>
    item.trigger.on === 'event' ? [item.trigger.event] : [],
  );
  expect(new Set(events).size).toBe(events.length);
});
