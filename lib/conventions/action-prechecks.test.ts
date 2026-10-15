// Rule test: every view that imports an action the server can refuse asks the action's client pre-check from lib/ui/action-prechecks.ts first.
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ACTION_PRECHECKS, type ActionPrecheck } from '@/lib/ui/action-prechecks';
import {
  findPrecheckTableProblems,
  findUnpairedActionViews,
  type RepositoryText,
} from './action-prechecks-scan';
import { listProductSources, repositoryRoot } from './product-sources';

// Tier 2 for the werkflow-design rule "never let a user start a change the
// server will refuse" (Calendar canon, "History"). The table names, per
// action kind, the refusal codes, the predicate and the actions; this test
// holds the views and the server to it.

function readRepository(): RepositoryText {
  const files = new Map<string, string>();
  const read = (path: string): void => {
    files.set(path, readFileSync(resolve(repositoryRoot, path), 'utf8'));
  };
  for (const path of listProductSources()) read(path);
  for (const directory of ['supabase/migrations', 'supabase/tests']) {
    for (const name of readdirSync(resolve(repositoryRoot, directory))) {
      if (name.endsWith('.sql')) read(`${directory}/${name}`);
    }
  }
  return files;
}

const repository = readRepository();

test('every refusal code, predicate, action, server owner and exemption in the table holds', () => {
  expect(findPrecheckTableProblems(repository, ACTION_PRECHECKS)).toEqual([]);
});

test('every view that imports a refusable action pairs it with its pre-check', () => {
  expect(findUnpairedActionViews(repository, ACTION_PRECHECKS)).toEqual([]);
});

// Planted defects: small in-memory repositories, one that must fail next to one that must pass.
const PLANTED_ROW: ActionPrecheck = {
  kind: 'planted-occurrence-change',
  serverCodes: ['started_planning_occurrence_immutable'],
  predicate: { module: 'lib/calendar/board.ts', exportName: 'isStartedOccurrence' },
  wrappers: [],
  actions: [{ module: 'lib/planning/actions.ts', exportName: 'updatePlanningCalendarEntry' }],
  screenedReads: [],
  props: ['locked'],
  server: { kind: 'sql', test: 'supabase/tests/planning.sql' },
  exempt: {},
};
const PLANTED_LIB: ReadonlyMap<string, string> = new Map([
  ['lib/calendar/board.ts', 'export function isStartedOccurrence() { return true; }'],
  ['lib/planning/actions.ts', "'use server';\nexport async function updatePlanningCalendarEntry() {}"],
  ['supabase/migrations/1_planning.sql', "raise exception 'started_planning_occurrence_immutable';"],
  ['supabase/tests/planning.sql', "sqlerrm = 'started_planning_occurrence_immutable'"],
]);
const ACTION_IMPORT = "import { updatePlanningCalendarEntry } from '@/lib/planning/actions';";

function planted(files: Record<string, string>): RepositoryText {
  return new Map([...PLANTED_LIB, ...Object.entries(files)]);
}

test('planted: a view that imports the action without the predicate is named with its row', () => {
  const unpaired = planted({
    'components/kalender/day-lane-item.tsx': `${ACTION_IMPORT}\nexport function Item() {}`,
  });
  expect(findUnpairedActionViews(unpaired, [PLANTED_ROW])).toEqual([
    {
      file: 'components/kalender/day-lane-item.tsx',
      kind: 'planted-occurrence-change',
      actions: ['updatePlanningCalendarEntry'],
    },
  ]);

  const paired = planted({
    'components/kalender/day-lane-item.tsx': `${ACTION_IMPORT}\nimport { isStartedOccurrence } from '@/lib/calendar/board';`,
    'components/kalender/card.tsx': `${ACTION_IMPORT}\ntype CardProps = { locked: boolean };`,
    'components/kalender/use-write.ts': `${ACTION_IMPORT}\nexport function useWrite() {}`,
    'components/kalender/popover.tsx':
      "import { useWrite } from './use-write';\nimport { isStartedOccurrence } from '@/lib/calendar/board';",
  });
  expect(findUnpairedActionViews(paired, [PLANTED_ROW])).toEqual([]);
});

test('planted: a hook inherits the check only when every caller asks it', () => {
  const hook = `${ACTION_IMPORT}\nexport function useWrite() {}`;
  const unpaired = planted({
    'components/kalender/use-write.ts': hook,
    'components/kalender/popover.tsx':
      "import { useWrite } from './use-write';\nimport { isStartedOccurrence } from '@/lib/calendar/board';",
    'components/kalender/other.tsx': "import { useWrite } from './use-write';",
  });
  expect(findUnpairedActionViews(unpaired, [PLANTED_ROW]).map((finding) => finding.file)).toEqual([
    'components/kalender/use-write.ts',
  ]);
});

test('planted: a stale code, a missing SQL assertion and a short exemption reason are table problems', () => {
  const row: ActionPrecheck = {
    ...PLANTED_ROW,
    serverCodes: ['started_planning_occurrence_immutable', 'never_raised_code'],
    exempt: { 'components/kalender/day-lane-item.tsx': 'Too short.' },
  };
  const repositoryText = planted({
    'components/kalender/day-lane-item.tsx': ACTION_IMPORT,
    'supabase/tests/planning.sql': 'select 1;',
  });
  expect(findPrecheckTableProblems(repositoryText, [row])).toEqual([
    'planted-occurrence-change: no file under lib/ or supabase/migrations/ names never_raised_code',
    'planted-occurrence-change: supabase/tests/planning.sql does not assert the database refusal started_planning_occurrence_immutable',
    'planted-occurrence-change: the exemption of components/kalender/day-lane-item.tsx needs a reason of 30 or more characters',
  ]);
  expect(
    findPrecheckTableProblems(planted({ 'components/kalender/day-lane-item.tsx': ACTION_IMPORT }), [
      PLANTED_ROW,
    ]),
  ).toEqual([]);
});

test('planted: a wrapper counts only when it reaches the predicate, directly or through another wrapper', () => {
  const row: ActionPrecheck = {
    ...PLANTED_ROW,
    wrappers: [
      { module: 'lib/calendar/checks.ts', exportName: 'checkMovable' },
      { module: 'components/kalender/permissions.ts', exportName: 'permissionsOf' },
    ],
  };
  const chained = planted({
    'lib/calendar/checks.ts':
      "import { isStartedOccurrence } from './board';\nexport function checkMovable() {}",
    'components/kalender/permissions.ts':
      "import { checkMovable } from '@/lib/calendar/checks';\nexport function permissionsOf() {}",
  });
  expect(findPrecheckTableProblems(chained, [row])).toEqual([]);
  const detached = planted({
    'lib/calendar/checks.ts': 'export function checkMovable() {}',
    'components/kalender/permissions.ts':
      "import { checkMovable } from '@/lib/calendar/checks';\nexport function permissionsOf() {}",
  });
  expect(findPrecheckTableProblems(detached, [row])).toEqual([
    'planted-occurrence-change: the wrapper checkMovable does not use isStartedOccurrence',
    'planted-occurrence-change: the wrapper permissionsOf does not use isStartedOccurrence',
  ]);
});

test('planted: a TypeScript server guard must use the predicate, and the action module must use the guard', () => {
  const row: ActionPrecheck = {
    ...PLANTED_ROW,
    server: {
      kind: 'typescript',
      guards: [{ module: 'lib/planning/guard.ts', exportName: 'assertMovable' }],
    },
  };
  const withoutPredicate = planted({ 'lib/planning/guard.ts': 'export function assertMovable() {}' });
  expect(findPrecheckTableProblems(withoutPredicate, [row])).toEqual([
    'planted-occurrence-change: the server guard assertMovable does not use isStartedOccurrence',
    'planted-occurrence-change: lib/planning/actions.ts uses neither isStartedOccurrence nor a listed server guard',
  ]);
  const owned = planted({
    'lib/planning/guard.ts':
      "import { isStartedOccurrence } from '@/lib/calendar/board';\nexport function assertMovable() {}",
    'lib/planning/actions.ts':
      "'use server';\nimport { assertMovable } from './guard';\nexport async function updatePlanningCalendarEntry() {}",
  });
  expect(findPrecheckTableProblems(owned, [row])).toEqual([]);
});
