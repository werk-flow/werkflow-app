// Rule test: every journey a role repeats is covered by an instrument that exists.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'bun:test';

import coverageMap from './selection/coverage-map.json';
import { JOURNEYS } from './journeys';
import { LAB_STEPS, LAB_SPEC_DIRECTORY } from './lab-steps';
import { MEASURED_SCENARIOS } from './measured-scenarios';
import { measuredTestSource } from './measured-test-source';

const repositoryRoot = resolve(import.meta.dir, '../..');
const SLUG = /^[a-z]+(\.[a-z]+(-[a-z]+)*)+$/;

test('journey ids are unique slugs, and both the field and the office have journeys', () => {
  const ids = JOURNEYS.map((journey) => journey.id);
  expect(ids.filter((id) => !SLUG.test(id))).toEqual([]);
  expect(new Set(ids).size).toBe(ids.length);
  const roles = new Set(JOURNEYS.map((journey) => journey.role));
  expect(roles.has('employee')).toBe(true);
  expect(roles.has('buero') || roles.has('admin')).toBe(true);
});

test('every journey has a lab step, and every named instrument exists', () => {
  const missing = JOURNEYS.flatMap((journey) => [
    ...(journey.labSteps.length ? [] : [`${journey.id}: no lab step`]),
    ...journey.labSteps
      .filter((id) => !LAB_STEPS.some((step) => step.id === id))
      .map((id) => `${journey.id}: unknown lab step ${id}`),
    ...journey.measuredScenarios
      .filter((id) => !MEASURED_SCENARIOS.some((scenario) => scenario.id === id))
      .map((id) => `${journey.id}: unknown measured scenario ${id}`),
  ]);
  expect(missing).toEqual([]);
});

test('every journey names flows of the user-flow catalog', () => {
  const catalog = new Set(Object.keys(coverageMap.catalogHashes));
  const unknown = JOURNEYS.flatMap((journey) => [
    ...(journey.catalogFlows.length ? [] : [`${journey.id}: no catalog flow`]),
    ...journey.catalogFlows.filter((id) => !catalog.has(id)).map((id) => `${journey.id}: ${id}`),
  ]);
  expect(unknown).toEqual([]);
});

test('every lab step belongs to exactly one journey of its role', () => {
  const wrong = LAB_STEPS.flatMap((step) => {
    const owners = JOURNEYS.filter((journey) => journey.labSteps.includes(step.id));
    if (owners.length !== 1) return [`${step.id}: named by ${owners.length} journeys`];
    const [owner] = owners;
    if (!owner || owner.id !== step.journey) return [`${step.id}: registered under ${step.journey}`];
    return owner.role === step.role ? [] : [`${step.id}: role ${step.role}, journey role ${owner.role}`];
  });
  expect(wrong).toEqual([]);
});

test('lab step ids are unique slugs, recorded by a test of a lab spec', () => {
  const ids = LAB_STEPS.map((step) => step.id);
  expect(new Set(ids).size).toBe(ids.length);
  const wrong = LAB_STEPS.flatMap((step) => {
    if (!/^lab\.[a-z]+\.[a-z]+(-[a-z]+)*$/.test(step.id)) return [`${step.id}: not a lab slug`];
    if (!step.file.startsWith(LAB_SPEC_DIRECTORY)) return [`${step.id}: ${step.file} is not a lab spec`];
    try {
      measuredTestSource(step.file, readFileSync(resolve(repositoryRoot, step.file), 'utf8'), step.id);
      return [];
    } catch (error) {
      return [`${step.id}: ${error instanceof Error ? error.message : String(error)}`];
    }
  });
  expect(wrong).toEqual([]);
});

test('a save step budgets one route render, and the idle step budgets no work at all', () => {
  const wrong = LAB_STEPS.flatMap((step) => {
    if (
      step.kind === 'mutation' &&
      step.journey !== 'office.calendar.move' &&
      step.budgets.routeRenders !== 1
    )
      return [`${step.id}: a save renders the route once`];
    const idleWork = ['requests', 'routeRenders', 'reactCommits', 'domMutations', 'longTasks'] as const;
    if (step.kind === 'idle' && idleWork.some((metric) => step.budgets[metric] !== 0))
      return [`${step.id}: an idle step allows no request, render, commit, mutation or long task`];
    return [];
  });
  expect(wrong).toEqual([]);
});
