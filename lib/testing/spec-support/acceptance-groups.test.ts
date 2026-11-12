// Rule test: every rendered acceptance capture runs in exactly one registered group, every open set file is loaded into exactly one group, and a group's spec imports only the dialog openers its captures use.
import { expect, test } from 'bun:test';
import { Glob } from 'bun';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  INVENTORY_ROUNDS,
  OPENER_GROUPS,
  ROUND_GROUPS,
  roundCaptures,
  type AcceptanceSet,
} from '../../../tests/audit/support/acceptance-rounds';
import { acceptanceSetFiles, acceptanceSets } from '../../../tests/audit/support/acceptance-sets';
import { sourceImportGraph, UNKNOWN_IMPORT_DEPENDENCY } from '../evidence/group-evidence';
import { testExecutionClosure } from '../evidence/group-qualification';
import { getTestGroups } from '../selection/test-groups';

const ROOT = resolve(import.meta.dir, '../../..');
const SUPPORT = 'tests/audit/support';
const specOf = (group: string): string => `tests/audit/visual/acceptance-${group}.spec.ts`;

/** The test titles of a set's captures, as the specs build them. */
function titles(sets: readonly AcceptanceSet[]): string[] {
  return sets.flatMap((set) =>
    [...set.captures, ...set.standalone].map((capture) => `@ACCEPT ${set.id} ${capture.id}`),
  );
}

const SPECS = [...ROUND_GROUPS, 'sets'].map(specOf);
const SET_FILES = acceptanceSetFiles().map((file) => `${SUPPORT}/acceptance-sets/${file}`);
const FILES = [
  'app',
  'components',
  'hooks',
  'lib',
  'tests',
  'scripts',
  'supabase',
  'public',
  'eslint-rules',
].flatMap((directory) =>
  [...new Glob('**/*').scanSync({ cwd: join(ROOT, directory), onlyFiles: true })].map(
    (file) => `${directory}/${file.replaceAll('\\', '/')}`,
  ),
);
/** Every source file, so an import resolves as it does for selection; only what the specs and set files reach is parsed. */
const GRAPH = sourceImportGraph(ROOT, FILES, [...SPECS, ...SET_FILES]);

/** The test code a spec executes, by selection's own rule (group-qualification.ts). */
function executionInputs(spec: string): Set<string> {
  const reached = testExecutionClosure(GRAPH, FILES, [spec]);
  // An import selection cannot resolve widens a group to all test support.
  expect(GRAPH.get(spec)?.includes(UNKNOWN_IMPORT_DEPENDENCY), `${spec} imports an unresolved module`).toBe(
    false,
  );
  for (const file of reached)
    expect(GRAPH.get(file)?.includes(UNKNOWN_IMPORT_DEPENDENCY), `${file} imports an unresolved module`).toBe(
      false,
    );
  return reached;
}

test('every acceptance group is registered with its own spec file', () => {
  const registered = getTestGroups(ROOT).filter((group) => group.id.startsWith('audit:visual:acceptance'));
  expect(Object.fromEntries(registered.map((group) => [group.id, group.files]))).toEqual(
    Object.fromEntries(
      [...ROUND_GROUPS, 'sets'].map((group) => [`audit:visual:acceptance:${group}`, [specOf(group)]]),
    ),
  );
});

test('every capture of an inventory round runs in exactly one group, and no title repeats', () => {
  const grouped = ROUND_GROUPS.flatMap((group) => {
    const groupTitles = titles(roundCaptures(group));
    expect(groupTitles.length, group).toBeGreaterThan(0);
    return groupTitles;
  });
  expect(grouped.toSorted()).toEqual(titles(INVENTORY_ROUNDS).toSorted());
  // A focused run greps by set, so an open set never shares its id with a round.
  const all = [...grouped, ...titles(acceptanceSets())];
  expect(new Set(all).size).toBe(all.length);
});

test('the group without openers reaches only the step modules every page needs', () => {
  // A step module added here reaches every group again, as `steps/work.ts` did through time-tracking and personnel.
  const steps = 'tests/golden/support/steps/';
  expect(
    [...executionInputs(specOf('pages'))]
      .filter((file) => file.startsWith(steps))
      .map((file) => file.slice(steps.length))
      .toSorted(),
  ).toEqual(['interaction.ts', 'service.ts', 'shared.ts', 'time-tracking.ts']);
});

test('a group reaches only the opener module of its name, which holds every opener it captures', () => {
  for (const group of ROUND_GROUPS) {
    const reached = executionInputs(specOf(group));
    const own = OPENER_GROUPS.some((candidate) => candidate === group)
      ? [`${SUPPORT}/dialog-openers/${group}.ts`]
      : [];
    expect(
      [...reached].filter((file) => file.startsWith(`${SUPPORT}/dialog-openers`)),
      `${specOf(group)} imports only its own openers`,
    ).toEqual(own);
    // The open sets change with every change that adds a capture.
    for (const file of [`${SUPPORT}/acceptance-sets.ts`, ...SET_FILES])
      expect(reached.has(file), `${specOf(group)} reaches ${file}`).toBe(false);
    expect(reached.has(`${SUPPORT}/standalone-sessions.ts`), group).toBe(group === 'standalone');
    const source = own[0] ? readFileSync(join(ROOT, own[0]), 'utf8') : '';
    for (const capture of roundCaptures(group).flatMap((set) => set.captures))
      if (capture.view.kind === 'dialog')
        expect(source, `${own[0]} holds ${capture.view.opener}`).toContain(`  '${capture.view.opener}': `);
  }
});

test('every open set file holds one set named after it, and the sets group executes every file', () => {
  expect(acceptanceSets().map((set) => `${SUPPORT}/acceptance-sets/${set.id}.ts`)).toEqual(
    SET_FILES.toSorted(),
  );
  const sets = executionInputs(specOf('sets'));
  for (const file of SET_FILES) expect(sets.has(file), `the sets group executes ${file}`).toBe(true);
  // A set file seeds only its own records: no set file imports another.
  for (const file of SET_FILES)
    expect(
      (GRAPH.get(file) ?? []).filter((dependency) => SET_FILES.includes(dependency)),
      `${file} imports another set`,
    ).toEqual([]);
});

test('without an open set, the directory is absent and the sets are empty', () => {
  expect(acceptanceSetFiles(join(ROOT, 'tests/audit/support/no-such-directory'))).toEqual([]);
});
