// Rule test: a change selects the groups that can expose its failure.
import { expect, test } from 'bun:test';
import {
  CORE_SELECTION,
  changedTestTier,
  groupSelections,
  measuredGroupsForChange,
  passedSinceSelection,
  selectionBaseline,
} from './group-selection';

const browser = (id: string, scopes: string[], executionInputs: string[] = []) => ({
  id,
  kind: id.startsWith('golden:') ? 'golden' : 'audit',
  scopes,
  executionInputs,
});
const groups = [
  { id: 'static:docs', kind: 'static' },
  { id: 'static:dependencies', kind: 'static' },
  { id: 'unit:all', kind: 'unit' },
  { id: 'ui:contracts', kind: 'ui' },
  { id: 'sql:p1-21', kind: 'sql' },
  browser('golden:gg-00', ['*'], ['tests/golden/gg-00.spec.ts', 'tests/golden/support/steps/shared.ts']),
  browser(
    'golden:p1-24a',
    ['planning', 'time'],
    ['tests/golden/p1-24a.spec.ts', 'tests/golden/support/steps/shared.ts'],
  ),
  browser('audit:wave-3:p1-24a', ['planning', 'time'], ['tests/audit/wave-3/p1-24a.spec.ts']),
  browser('audit:wave-2:p1-13', ['work', 'inventory'], ['tests/audit/wave-2/p1-13.spec.ts']),
  browser('audit:layout', ['*'], ['tests/audit/layout/mobile-viewport.spec.ts']),
  browser('audit:security:account', ['*'], ['tests/audit/security/account.spec.ts']),
  {
    ...browser('audit:performance:calendar', ['planning'], ['tests/audit/performance/calendar.spec.ts']),
    releaseOnly: true,
  },
  {
    ...browser('audit:visual', ['*'], ['tests/audit/visual/references.spec.ts']),
    releaseOnly: true,
  },
];
const CHEAP = ['static:docs', 'unit:all', 'ui:contracts', 'sql:p1-21'];
function select(
  changedFiles: string[],
  unresolvedGroupIds: string[] = [],
  mode: 'change' | 'release' = 'change',
): string[] {
  return [...groupSelections({ mode, groups, changedFiles, unresolvedGroupIds }).keys()];
}
const browserOnly = (ids: string[]): string[] => ids.filter((id) => /^(golden|audit):/.test(id));

test('the cheap gates are always in a change plan; the dependency audit only for its own inputs', () => {
  expect(select([])).toEqual(CHEAP);
  expect(select(['docs-free/script.ts'])).toEqual(CHEAP);
  expect(select(['bun.lock'])).toContain('static:dependencies');
  expect(select([], ['static:dependencies'])).toContain('static:dependencies');
  expect(select(['app/(app)/kalender/page.tsx'])).not.toContain('static:dependencies');
});

test('an owned product file selects the browser groups that declare its scope, and nothing else', () => {
  expect(browserOnly(select(['components/kalender/board/board-row.tsx']))).toEqual([
    'golden:p1-24a',
    'audit:wave-3:p1-24a',
  ]);
  expect(browserOnly(select(['lib/inventory/actions.ts']))).toEqual(['audit:wave-2:p1-13']);
  // A deleted or new file under an owned directory is owned by its path; nothing widens.
  expect(browserOnly(select(['lib/inventory/removed-module.ts']))).toEqual(['audit:wave-2:p1-13']);
  const selection = groupSelections({
    mode: 'change',
    groups,
    changedFiles: ['lib/calendar/a.ts', 'lib/inventory/b.ts', 'lib/time-tracking/c.ts'],
    unresolvedGroupIds: [],
  });
  expect(selection.get('golden:p1-24a')).toEqual({
    reason: 'Declared scope: planning',
    changedFiles: ['lib/calendar/a.ts', 'lib/time-tracking/c.ts'],
  });
});

test('the core table is the whole answer for product code no scope owns', () => {
  const expectations: readonly (readonly [string, string[]])[] = [
    ['components/ui/button.tsx', ['golden:gg-00', 'audit:layout']],
    ['app/globals.css', ['golden:gg-00', 'audit:layout']],
    ['proxy.ts', ['golden:gg-00', 'audit:security:account']],
    ['lib/auth/actions.ts', ['golden:gg-00', 'audit:security:account']],
    ['app/(auth)/login/page.tsx', ['golden:gg-00', 'audit:security:account']],
    ['lib/data/cached.ts', ['golden:gg-00', 'audit:security:account']],
    ['package.json', ['golden:gg-00', 'audit:layout', 'audit:security:account']],
    ['<environment>', ['golden:gg-00', 'audit:layout', 'audit:security:account']],
    ['hooks/use-live-view.ts', ['golden:gg-00']],
    ['lib/data/background-reads.ts', ['golden:gg-00']],
    ['lib/supabase/database.types.ts', ['golden:gg-00']],
    ['supabase/migrations/20261001000000_new.sql', ['golden:gg-00']],
    ['app/(app)/layout.tsx', ['golden:gg-00']],
    ['lib/removed-unmapped-module.ts', ['golden:gg-00']],
  ];
  for (const [file, expected] of expectations)
    expect([file, browserOnly(select([file]))]).toEqual([file, expected]);
  // The table names registered groups only, so a renamed group cannot silently leave the core set.
  expect(
    CORE_SELECTION.flatMap((row) => row.groups).every((id) => groups.some((group) => group.id === id)),
  ).toBe(true);
});

test('test code selects the groups that execute it; scripts, documentation tooling and unit tests select no browser group', () => {
  expect(browserOnly(select(['tests/golden/p1-24a.spec.ts']))).toEqual(['golden:p1-24a']);
  expect(browserOnly(select(['tests/golden/support/steps/shared.ts']))).toEqual([
    'golden:gg-00',
    'golden:p1-24a',
  ]);
  for (const file of [
    'scripts/check-docs.ts',
    'lib/testing/selection/group-selection.test.ts',
    'lib/calendar/window.test.ts',
    'eslint.config.mjs',
    'lib/docs/check.ts',
    'supabase/tests/p1_21_time_segments.sql',
  ]) {
    expect([file, browserOnly(select([file]))]).toEqual([file, []]);
  }
});

test('a runner change runs both integration pilots', () => {
  for (const file of [
    'lib/testing/selection/group-selection.ts',
    'lib/testing/runner/playwright-discovery.ts',
    'scripts/realtime-probe.ts',
    'scripts/verify.ts',
  ]) {
    expect(browserOnly(select([file]))).toEqual(['golden:p1-24a', 'audit:wave-3:p1-24a']);
  }
});

test('repair mode selects exactly the failed or blocked browser groups, whatever the repair touched', () => {
  const repair = [
    'components/ui/button.tsx',
    'lib/calendar/a.ts',
    'lib/inventory/b.ts',
    'lib/testing/selection/group-selection.ts',
    'tests/golden/support/steps/shared.ts',
  ];
  expect(select(repair, ['audit:wave-2:p1-13'])).toEqual([...CHEAP, 'audit:wave-2:p1-13']);
  expect(select([], ['audit:wave-2:p1-13', 'golden:gg-00'])).toEqual([
    ...CHEAP,
    'golden:gg-00',
    'audit:wave-2:p1-13',
  ]);
  // An unresolved cheap gate or a release-only group does not start repair mode.
  expect(
    browserOnly(select(['lib/inventory/b.ts'], ['unit:all', 'audit:performance:calendar', 'retired:group'])),
  ).toEqual(['audit:wave-2:p1-13']);
});

test('performance groups run in release mode only; release selects every group', () => {
  for (const changed of [
    ['lib/calendar/a.ts'],
    ['tests/audit/performance/calendar.spec.ts'],
    ['app/globals.css'],
  ]) {
    expect(select(changed)).not.toContain('audit:performance:calendar');
  }
  expect(select([], ['audit:performance:calendar'])).not.toContain('audit:performance:calendar');
  expect(select([], [], 'release')).toEqual(groups.map((group) => group.id));
});

test('visual references run in release mode only, even when shared controls, tokens or their spec change', () => {
  for (const changed of [
    ['components/ui/button.tsx'],
    ['app/globals.css'],
    ['app/(app)/kunden/page.tsx'],
    ['tests/audit/visual/references.spec.ts'],
    ['package.json'],
  ]) {
    expect(select(changed)).not.toContain('audit:visual');
  }
  // A failed visual run neither starts repair mode nor returns in a change plan; its repair runs with --group.
  expect(browserOnly(select(['lib/inventory/b.ts'], ['audit:visual']))).toEqual(['audit:wave-2:p1-13']);
  expect(select([], [], 'release')).toContain('audit:visual');
});

test('a browser pass counts only when it ran on the current content of the files that selected it', () => {
  const then = { 'lib/calendar/a.ts': '1', 'lib/inventory/b.ts': '1', 'tests/golden/p1-24a.spec.ts': '1' };
  const selection = { reason: 'Declared scope: planning', changedFiles: ['lib/calendar/a.ts'] };
  expect(passedSinceSelection({ then, now: then, selection })).toBe(true);
  expect(passedSinceSelection({ then, now: { ...then, 'lib/inventory/b.ts': '2' }, selection })).toBe(true);
  expect(passedSinceSelection({ then, now: { ...then, 'lib/calendar/a.ts': '2' }, selection })).toBe(false);
  expect(passedSinceSelection({ then: { 'lib/inventory/b.ts': '1' }, now: then, selection })).toBe(false);
  // The environment is part of the fingerprint, not of the snapshot's files.
  expect(
    passedSinceSelection({
      then,
      now: then,
      selection: { reason: 'Core set', changedFiles: ['<environment>'] },
    }),
  ).toBe(true);
  // Release mode and explicit groups name no selecting file: every product file must match, test code need not.
  expect(
    passedSinceSelection({
      then,
      now: { ...then, 'tests/golden/p1-24a.spec.ts': '2' },
      selection: undefined,
    }),
  ).toBe(true);
  expect(
    passedSinceSelection({ then, now: { ...then, 'lib/inventory/b.ts': '2' }, selection: undefined }),
  ).toBe(false);
  expect(
    passedSinceSelection({
      then,
      now: { ...then, 'lib/new.ts': '1' },
      selection: { reason: 'Release coverage', changedFiles: [] },
    }),
  ).toBe(false);
});

test('the baseline is the latest passing automatic plan, or the explicit run that resolved its last failure', () => {
  const report = (
    id: string,
    scope: 'selected-groups' | 'all-required-groups',
    results: Record<string, 'passed' | 'failed' | 'blocked'>,
    selected = Object.keys(results),
  ) => ({
    id,
    scope,
    selected,
    status:
      Object.values(results).every((status) => status === 'passed') &&
      selected.every((group) => group in results)
        ? ('passed' as const)
        : ('failed' as const),
    results: Object.entries(results).map(([groupId, status]) => ({ groupId, status })),
  });
  const first = report('first', 'all-required-groups', { a: 'passed', b: 'passed' });
  const failed = report('failed', 'all-required-groups', { a: 'passed', b: 'failed', c: 'blocked' });
  expect(selectionBaseline([])).toBeUndefined();
  expect(selectionBaseline([first, failed])?.id).toBe('first');
  // An explicit pass of one failed group is not yet a verified repair.
  expect(selectionBaseline([first, failed, report('b', 'selected-groups', { b: 'passed' })])?.id).toBe(
    'first',
  );
  expect(
    selectionBaseline([
      first,
      failed,
      report('b', 'selected-groups', { b: 'passed' }),
      report('c', 'selected-groups', { c: 'passed' }),
    ])?.id,
  ).toBe('c');
  // The repair-mode run is an automatic plan: its pass is the new baseline.
  expect(
    selectionBaseline([first, failed, report('repair', 'all-required-groups', { b: 'passed', c: 'passed' })])
      ?.id,
  ).toBe('repair');
  // An explicit run without an open failure never moves the baseline, and an aborted plan leaves its unrecorded groups open.
  expect(selectionBaseline([first, report('explicit', 'selected-groups', { a: 'passed' })])?.id).toBe(
    'first',
  );
  const aborted = report('aborted', 'all-required-groups', { a: 'passed' }, ['a', 'b']);
  expect(selectionBaseline([first, aborted, report('a-again', 'selected-groups', { a: 'passed' })])?.id).toBe(
    'first',
  );
});

test('the plan names a measured group whose scope owns a changed product file, without selecting it', () => {
  const changedFiles = [
    'components/kalender/board/board-row.tsx',
    'lib/inventory/actions.ts',
    'tests/a.spec.ts',
  ];
  expect(measuredGroupsForChange(groups, changedFiles)).toEqual([
    { id: 'audit:performance:calendar', changedFiles: ['components/kalender/board/board-row.tsx'] },
  ]);
  expect(select(changedFiles)).not.toContain('audit:performance:calendar');
  expect(measuredGroupsForChange(groups, ['lib/inventory/actions.ts', 'tests/golden/gg-00.spec.ts'])).toEqual(
    [],
  );
});

test('changed-spec-first: a group whose own spec or test support changed is tier 0; harness and product changes decide no order', () => {
  const inputs = [
    'tests/golden/p1-13.spec.ts',
    'tests/golden/support/steps/work.ts',
    'lib/testing/runner/run-policy.ts',
  ];
  expect(changedTestTier(inputs, ['tests/golden/support/steps/work.ts'])).toBe(0);
  expect(changedTestTier(inputs, ['tests/golden/p1-13.spec.ts', 'components/ui/dialog.tsx'])).toBe(0);
  expect(changedTestTier(inputs, ['lib/testing/runner/run-policy.ts'])).toBe(1);
  expect(changedTestTier(inputs, ['components/ui/dialog.tsx'])).toBe(1);
  expect(changedTestTier(undefined, ['tests/golden/p1-13.spec.ts'])).toBe(1);
});
