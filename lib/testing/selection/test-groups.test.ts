// Rule test: every spec file is a registered group with its scopes.
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  getGroupTimingRequirements,
  getTestGroups,
  isPerformanceSpec,
  isReleaseOnlySpec,
  listTestFiles,
  validateTestGroupInventory,
  type TestGroup,
} from './test-groups';
import { expectDefined } from '../spec-support/expect-defined';
import { labStepsForFiles } from '../lab-steps';
import { groupSelections } from './group-selection';

function group(id: string, files: string[]): TestGroup {
  return {
    id,
    files,
    kind: 'golden',
    scopes: ['personnel'],
    isolation: 'group-world',
    timing: { requireFreshness: false, requireReadiness: false, exclusive: false },
  };
}

describe('independent group registry', () => {
  test('a new audit file cannot silently escape the executable inventory', () => {
    expect(
      validateTestGroupInventory([group('one', ['known.spec.ts'])], ['known.spec.ts', 'new.spec.ts']),
    ).toEqual(['Unregistered test file: new.spec.ts']);
    expect(
      validateTestGroupInventory([group('one', ['same.spec.ts']), group('two', ['same.spec.ts'])], []),
    ).toContain('Test file has two owners: same.spec.ts (one, two)');
  });

  test('visual references are release-only without enforcing latency deadlines', () => {
    const groups = getTestGroups(resolve(import.meta.dir, '../../..'));
    const visual = expectDefined(
      groups.find((candidate) => candidate.id === 'audit:visual'),
      'the registered visual reference group',
    );
    expect(visual.files).toEqual(['tests/audit/visual/references.spec.ts']);
    expect(visual.files.some(isReleaseOnlySpec)).toBe(true);
    expect(visual.files.some(isPerformanceSpec)).toBe(false);
    expect(visual.timing.exclusive).toBe(false);
    for (const performance of groups.filter((candidate) => candidate.id.startsWith('audit:performance:')))
      expect([performance.id, performance.files.every(isReleaseOnlySpec)]).toEqual([performance.id, true]);
    const releaseOnly = groups.filter((candidate) => candidate.files.some(isReleaseOnlySpec));
    expect(releaseOnly.every((candidate) => candidate.kind === 'audit')).toBe(true);
    // The runner passes the same flag; a change plan with every file changed still leaves them out.
    const plan = groupSelections({
      mode: 'change',
      groups: groups.map((candidate) => ({
        ...candidate,
        releaseOnly: candidate.files.some(isReleaseOnlySpec),
      })),
      changedFiles: ['components/ui/button.tsx', 'app/globals.css', 'tests/audit/visual/references.spec.ts'],
      unresolvedGroupIds: [],
    });
    for (const candidate of releaseOnly) expect(plan.has(candidate.id)).toBe(false);
  });

  test('a golden slice takes the scopes of its audit definition in any wave', () => {
    const groups = getTestGroups(resolve(import.meta.dir, '../../..'));
    const scopesOf = (id: string): readonly string[] | undefined =>
      groups.find((candidate) => candidate.id === id)?.scopes;
    expect(scopesOf('golden:p1-24a')).toEqual(scopesOf('audit:wave-3:p1-24a'));
    expect(scopesOf('golden:p1-16')).toEqual(scopesOf('audit:wave-2:p1-16'));
    expect(scopesOf('golden:p1-24a')).not.toEqual(['*']);
  });

  test('current browser groups own their files without a cross-file producer', () => {
    const groups = getTestGroups(resolve(import.meta.dir, '../../..'));
    const auditFiles = groups
      .filter((entry) => entry.kind === 'audit')
      .flatMap((entry) => entry.files)
      .sort();
    expect(auditFiles).toEqual(
      listTestFiles(resolve(import.meta.dir, '../../..'), 'tests/audit', /\.spec\.ts$/),
    );
    expect(
      groups.filter((entry) => entry.kind === 'audit').every((entry) => entry.isolation === 'group-world'),
    ).toBe(true);
    const schedules = expectDefined(groups.find((entry) => entry.id === 'golden:p1-04'));
    expect(schedules.files).toEqual(['tests/golden/p1-04.spec.ts']);
  });

  test('audit P1-22 cannot run concurrently when its readiness measurement lives in a helper', () => {
    const root = resolve(import.meta.dir, '../../..');
    const groups = getTestGroups(root);
    const audit = expectDefined(groups.find((entry) => entry.id === 'audit:wave-2:p1-22'));
    expect(audit.timing).toEqual({
      requireFreshness: false,
      requireReadiness: true,
      requiredScenarios: [],
      requiredLabSteps: [],
      exclusive: true,
    });
    // Clearing incidental caller metadata cannot erase the required helper contract.
    expect(
      getGroupTimingRequirements(
        { ...audit, timing: { requireFreshness: false, requireReadiness: false, exclusive: false } },
        root,
      ),
    ).toEqual({
      requireFreshness: false,
      requireReadiness: true,
      requiredScenarios: [],
      requiredLabSteps: [],
      exclusive: true,
    });
    expect(
      getGroupTimingRequirements(expectDefined(groups.find((entry) => entry.id === 'golden:p1-22')), root)
        .requireReadiness,
    ).toBe(true);
    expect(groups.some((entry) => entry.id === 'golden:integrated')).toBe(false);
  });

  test('a lab group runs alone, in release mode and on request only, and must record each of its steps', () => {
    const root = resolve(import.meta.dir, '../../..');
    for (const id of ['audit:lab:field', 'audit:lab:office']) {
      const group = expectDefined(getTestGroups(root).find((entry) => entry.id === id));
      expect(group.files.every(isReleaseOnlySpec)).toBe(true);
      const timing = getGroupTimingRequirements(group, root);
      expect(timing.exclusive).toBe(true);
      expect(timing.requiredLabSteps).toEqual(labStepsForFiles(group.files).map((step) => step.id));
      expect(timing.requiredLabSteps?.length).toBeGreaterThan(0);
    }
  });

  test('the actual Plantafel freshness measurement is exclusive even without caller metadata', () => {
    const root = resolve(import.meta.dir, '../../..');
    const groups = getTestGroups(root);
    const plantafel = groups.find((entry) => entry.id === 'golden:p1-24a');
    if (!plantafel) throw new Error('Plantafel group is missing');
    const timing = getGroupTimingRequirements(
      { ...plantafel, timing: { requireFreshness: false, requireReadiness: false, exclusive: false } },
      root,
    );
    expect(timing.requireFreshness).toBe(true);
    expect(timing.exclusive).toBe(true);
  });

  test('new freshness calls, aliases and namespace calls reserve exclusive time without a title tag', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'werkflow-timing-'));
    const file = 'tests/golden/new.spec.ts';
    mkdirSync(resolve(root, 'tests/golden'), { recursive: true });
    const entry = group('new', [file]);
    try {
      for (const source of [
        `import { expectLiveWithin } from './support/freshness'; await expectLiveWithin(page, check);`,
        `import { expectLiveWithin as measure } from './support/freshness'; async function helper() { await measure(page, check); }`,
        `import * as timing from './support/freshness'; await timing.expectLiveWithin(page, check);`,
      ]) {
        writeFileSync(resolve(root, file), source);
        expect(getGroupTimingRequirements(entry, root)).toMatchObject({
          requireFreshness: true,
          exclusive: true,
        });
      }
      writeFileSync(
        resolve(root, file),
        `// expectLiveWithin(page, check)\nconst text = 'expectLiveWithin';`,
      );
      expect(getGroupTimingRequirements(entry, root)).toMatchObject({
        requireFreshness: false,
        exclusive: false,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('all declared freshness scopes reserve exclusive measurement time', () => {
    const groups = getTestGroups(resolve(import.meta.dir, '../../..'));
    const measured = groups.filter((entry) => entry.timing.requireFreshness);
    expect(measured.map((entry) => entry.id)).toContain('golden:p1-24a');
    expect(measured.every((entry) => entry.timing.exclusive)).toBe(true);
  });

  test('measured scenarios pin their spec, force exclusive scheduling, and cannot drift from source', () => {
    const root = resolve(import.meta.dir, '../../..');
    const groups = getTestGroups(root);
    const performance = expectDefined(groups.find((entry) => entry.id === 'audit:performance:calendar'));
    expect(performance.timing.exclusive).toBe(true);
    expect(performance.timing.requiredScenarios).toContain('calendar.board-to-day.covered');
    const planning = getGroupTimingRequirements(
      expectDefined(groups.find((entry) => entry.id === 'golden:p1-11')),
      root,
    );
    expect(planning.requireFreshness).toBe(true);
    expect(planning.requireReadiness).toBe(true);
    expect(planning.requiredScenarios).toEqual([]);
    const benchmark = getGroupTimingRequirements(
      expectDefined(groups.find((entry) => entry.id === 'audit:performance:planning')),
      root,
    );
    expect(benchmark.exclusive).toBe(true);
    expect(benchmark.requiredScenarios).toEqual([
      'planning.occurrence.cross-session',
      'calendar.month.employee-open-to-event',
      'calendar.month.admin-open-to-legacy-event',
    ]);
    const untimed = expectDefined(groups.find((entry) => entry.id === 'audit:wave-1:a2-anfragen'));
    expect(getGroupTimingRequirements(untimed, root).requiredScenarios).toEqual([]);
  });

  test('every static gate runs a package script, and the formatter gate is in every change plan', () => {
    const root = resolve(import.meta.dir, '../../..');
    const groups = getTestGroups(root);
    const packageScripts: Record<string, string> = JSON.parse(
      readFileSync(resolve(root, 'package.json'), 'utf8'),
    ).scripts;
    const staticGroups = groups.filter((entry) => entry.kind === 'static');
    expect(
      staticGroups.filter((entry) => !entry.script || !packageScripts[entry.script]).map((entry) => entry.id),
    ).toEqual([]);
    const format = expectDefined(groups.find((entry) => entry.id === 'static:format'));
    expect(format.script).toBe('format:check');
    expect(packageScripts['format:check']).toContain('prettier --check');
    // A static gate is selected without changed files, so the passing report the pre-push gate requires includes it.
    const plan = groupSelections({ mode: 'change', groups, changedFiles: [], unresolvedGroupIds: [] });
    expect(plan.get('static:format')).toEqual({ reason: 'Current policy check', changedFiles: [] });
  });
});
