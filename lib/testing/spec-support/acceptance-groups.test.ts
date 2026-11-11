// Rule test: every rendered acceptance capture runs in exactly one registered group, and a group's spec imports only the dialog openers its captures use.
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
import { ACCEPTANCE_SETS } from '../../../tests/audit/support/acceptance-sets';
import { sourceImportGraph } from '../evidence/group-evidence';
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

/** The test support a spec reaches through its imports, type-only imports included, as selection reads them. */
function supportReachedBy(spec: string): Set<string> {
  const files = [...new Glob('**/*.ts').scanSync({ cwd: join(ROOT, 'tests'), onlyFiles: true })].map(
    (file) => `tests/${file.replaceAll('\\', '/')}`,
  );
  const graph = sourceImportGraph(ROOT, files, [spec]);
  const reached = new Set<string>();
  const pending = [spec];
  while (pending.length) {
    const file = pending.pop();
    if (file === undefined || reached.has(file)) continue;
    reached.add(file);
    pending.push(...(graph.get(file) ?? []));
  }
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
  const all = [...grouped, ...titles(ACCEPTANCE_SETS)];
  expect(new Set(all).size).toBe(all.length);
});

test('a group reaches only the opener module of its name, which holds every opener it captures', () => {
  for (const group of ROUND_GROUPS) {
    const reached = supportReachedBy(specOf(group));
    const own = OPENER_GROUPS.some((candidate) => candidate === group)
      ? [`${SUPPORT}/dialog-openers/${group}.ts`]
      : [];
    expect(
      [...reached].filter((file) => file.startsWith(`${SUPPORT}/dialog-openers`)),
      `${specOf(group)} imports only its own openers`,
    ).toEqual(own);
    // The open sets and their seeded records change with every change that adds a capture.
    for (const file of ['acceptance-sets.ts', 'acceptance-records.ts'])
      expect(reached.has(`${SUPPORT}/${file}`), `${specOf(group)} reaches ${file}`).toBe(false);
    expect(reached.has(`${SUPPORT}/standalone-sessions.ts`), group).toBe(group === 'standalone');
    const source = own[0] ? readFileSync(join(ROOT, own[0]), 'utf8') : '';
    for (const capture of roundCaptures(group).flatMap((set) => set.captures))
      if (capture.view.kind === 'dialog')
        expect(source, `${own[0]} holds ${capture.view.opener}`).toContain(`  '${capture.view.opener}': `);
  }
});
