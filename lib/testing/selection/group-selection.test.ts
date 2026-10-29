// Rule test: a change selects the groups that can expose its failure.
import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import {
  CORE_SELECTION,
  changedTestTier,
  groupSelections,
  measuredGroupsForChange,
  passedSinceSelection,
  selectionBaseline,
} from './group-selection';
import type { ChangeTrigger } from './change-triggers';
import { getTestGroups } from './test-groups';

const browser = (id: string, trigger: ChangeTrigger, scopes: string[], executionInputs: string[] = []) => ({
  id,
  kind: id.startsWith('golden:') ? 'golden' : 'audit',
  scopes,
  executionInputs,
  trigger,
});
const groups = [
  { id: 'static:docs', kind: 'static' },
  { id: 'static:dependencies', kind: 'static' },
  { id: 'unit:all', kind: 'unit' },
  { id: 'ui:contracts', kind: 'ui' },
  { id: 'sql:p1-21', kind: 'sql' },
  browser(
    'golden:gg-00',
    'critical',
    ['*'],
    [
      'tests/golden/gg-00.spec.ts',
      'tests/golden/support/steps/shared.ts',
      'tests/golden/support/fixtures.ts',
    ],
  ),
  browser('golden:p1-21', 'critical', ['time', 'work'], ['tests/golden/p1-21.spec.ts']),
  browser(
    'golden:p1-24a',
    'scope',
    ['planning', 'time'],
    ['tests/golden/p1-24a.spec.ts', 'tests/golden/support/steps/shared.ts'],
  ),
  browser('audit:wave-3:p1-24a', 'scope', ['planning', 'time'], ['tests/audit/wave-3/p1-24a.spec.ts']),
  browser('audit:wave-2:p1-13', 'scope', ['work', 'inventory'], ['tests/audit/wave-2/p1-13.spec.ts']),
  browser(
    'audit:wave-1:a1-kunden',
    'own-test',
    ['customers', 'work'],
    ['tests/audit/wave-1/a1-kunden.spec.ts', 'tests/audit/support/customers.ts'],
  ),
  browser('audit:layout', 'release-only', ['*'], ['tests/audit/layout/mobile-viewport.spec.ts']),
  browser(
    'audit:layout:work',
    'release-only',
    ['work', 'customers'],
    ['tests/audit/layout/surfaces-work.spec.ts'],
  ),
  browser('audit:security:account', 'scope', ['*'], ['tests/audit/security/account.spec.ts']),
  browser(
    'audit:performance:calendar',
    'release-only',
    ['planning'],
    ['tests/audit/performance/calendar.spec.ts'],
  ),
  browser('audit:visual', 'release-only', ['*'], ['tests/audit/visual/references.spec.ts']),
];
const CRITICAL = ['golden:gg-00', 'golden:p1-21'];
const CHEAP = ['static:docs', 'static:dependencies', 'unit:all', 'ui:contracts', 'sql:p1-21'];
function select(
  changedFiles: string[],
  unresolvedGroupIds: string[] = [],
  mode: 'change' | 'release' = 'change',
): string[] {
  return [...groupSelections({ mode, groups, changedFiles, unresolvedGroupIds }).keys()];
}
const browserOnly = (ids: string[]): string[] => ids.filter((id) => /^(golden|audit):/.test(id));

test('the cheap gates and the advisory check are always in a change plan', () => {
  expect(select([])).toEqual(CHEAP);
  expect(select(['docs-free/script.ts'])).toEqual(CHEAP);
  const reason = (changedFiles: string[], unresolved: string[] = []) =>
    groupSelections({ mode: 'change', groups, changedFiles, unresolvedGroupIds: unresolved }).get(
      'static:dependencies',
    );
  expect(reason(['bun.lock'])).toEqual({ reason: 'Dependency inputs changed', changedFiles: ['bun.lock'] });
  expect(reason([], ['static:dependencies'])?.reason).toBe('Unresolved result');
  // Probe: without this row a new advisory surfaced only when the lockfile changed.
  expect(reason(['app/(app)/kalender/page.tsx'])?.reason).toBe(
    'Advisory check; a pass stays reusable for 24 hours',
  );
});

test('a product file selects the critical journeys and the permission groups that declare its scope', () => {
  expect(browserOnly(select(['components/kalender/board/board-row.tsx']))).toEqual([
    ...CRITICAL,
    'golden:p1-24a',
    'audit:wave-3:p1-24a',
  ]);
  expect(browserOnly(select(['lib/inventory/actions.ts']))).toEqual([...CRITICAL, 'audit:wave-2:p1-13']);
  // A deleted or new file under an owned directory is owned by its path; nothing widens.
  expect(browserOnly(select(['lib/inventory/removed-module.ts']))).toEqual([
    ...CRITICAL,
    'audit:wave-2:p1-13',
  ]);
  // A group without a permission test waits for the nightly run, even when its scope owns the file.
  expect(browserOnly(select(['lib/clients/actions.ts']))).toEqual(CRITICAL);
  const selection = groupSelections({
    mode: 'change',
    groups,
    changedFiles: ['lib/calendar/a.ts', 'lib/inventory/b.ts', 'lib/time-tracking/c.ts'],
    unresolvedGroupIds: [],
  });
  expect(selection.get('golden:p1-24a')).toEqual({
    reason: 'Permission test, declared scope: planning',
    changedFiles: ['lib/calendar/a.ts', 'lib/time-tracking/c.ts'],
  });
  expect(selection.get('golden:p1-21')).toEqual({
    reason: 'Critical journey: product code changed',
    changedFiles: ['lib/calendar/a.ts', 'lib/inventory/b.ts', 'lib/time-tracking/c.ts'],
  });
});

test('a group outside the critical set and the permission groups runs only when its own test code changed', () => {
  expect(browserOnly(select(['tests/audit/wave-1/a1-kunden.spec.ts']))).toEqual(['audit:wave-1:a1-kunden']);
  // Shared support also selects the critical journeys, which may import it later.
  expect(browserOnly(select(['tests/audit/support/customers.ts']))).toEqual([
    ...CRITICAL,
    'audit:wave-1:a1-kunden',
  ]);
  // Test code no browser group executes selects no browser group.
  expect(browserOnly(select(['tests/audit/support/unused-helper.ts']))).toEqual([]);
  expect(browserOnly(select(['docs/technical/testing.md', 'README.md']))).toEqual([]);
});

test('the critical journeys and the core table are the whole answer for product code no scope owns', () => {
  const account = 'audit:security:account';
  const expectations: readonly (readonly [string, string[]])[] = [
    // Shared controls and tokens leave the layout sweeps to full runs (decision 0007, amendment 2026-10-29).
    ['components/ui/button.tsx', CRITICAL],
    ['components/ui/dialog.tsx', CRITICAL],
    ['components/shared/area-nav.tsx', CRITICAL],
    ['app/globals.css', CRITICAL],
    ['proxy.ts', [...CRITICAL, account]],
    ['lib/auth/actions.ts', [...CRITICAL, account]],
    ['app/(auth)/login/page.tsx', [...CRITICAL, account]],
    ['lib/data/cached.ts', [...CRITICAL, account]],
    ['package.json', [...CRITICAL, account]],
    ['<environment>', [...CRITICAL, account]],
    ['hooks/use-live-view.ts', CRITICAL],
    ['lib/data/background-reads.ts', CRITICAL],
    ['lib/supabase/database.types.ts', CRITICAL],
    ['supabase/migrations/20261001000000_new.sql', CRITICAL],
    ['app/(app)/layout.tsx', CRITICAL],
    ['lib/removed-unmapped-module.ts', CRITICAL],
  ];
  for (const [file, expected] of expectations)
    expect([file, browserOnly(select([file]))]).toEqual([file, expected]);
  // The table names registered groups only, so a renamed group cannot silently leave the core set.
  const registered = new Set(getTestGroups(resolve(import.meta.dir, '../../..')).map((group) => group.id));
  expect(CORE_SELECTION.flatMap((row) => row.groups).filter((id) => !registered.has(id))).toEqual([]);
});

test('test code selects the groups that execute it; scripts, documentation tooling and unit tests select no browser group', () => {
  expect(browserOnly(select(['tests/golden/p1-24a.spec.ts']))).toEqual(['golden:p1-24a']);
  expect(browserOnly(select(['tests/golden/support/steps/shared.ts']))).toEqual([
    ...CRITICAL,
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

test('a shared fixture runs the integration pilots and the critical journeys', () => {
  expect(browserOnly(select(['tests/golden/support/fixtures.ts']))).toEqual([
    ...CRITICAL,
    'golden:p1-24a',
    'audit:wave-3:p1-24a',
  ]);
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

test('repair mode selects the failed or blocked browser groups, whatever product code the repair touched', () => {
  const repair = [
    'components/ui/button.tsx',
    'lib/calendar/a.ts',
    'lib/inventory/b.ts',
    'lib/testing/selection/group-selection.ts',
  ];
  expect(select(repair, ['audit:wave-2:p1-13'])).toEqual([...CHEAP, 'audit:wave-2:p1-13']);
  // A group's own test code changed during the repair runs too: it would otherwise become baseline unrun.
  // The critical journeys that do not execute it wait, like any group the repair's product code would select.
  const withTestCode = select([...repair, 'tests/golden/support/steps/shared.ts'], ['audit:wave-2:p1-13']);
  expect(browserOnly(withTestCode)).toEqual(['golden:gg-00', 'golden:p1-24a', 'audit:wave-2:p1-13']);
  expect(select([], ['audit:wave-2:p1-13', 'golden:gg-00'])).toEqual([
    ...CHEAP,
    'golden:gg-00',
    'audit:wave-2:p1-13',
  ]);
  // An unresolved cheap gate or a release-only group does not start repair mode.
  expect(
    browserOnly(select(['lib/inventory/b.ts'], ['unit:all', 'audit:performance:calendar', 'retired:group'])),
  ).toEqual([...CRITICAL, 'audit:wave-2:p1-13']);
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

test('visual references run in release mode only, even when shared controls or tokens change', () => {
  for (const changed of [
    ['components/ui/button.tsx'],
    ['app/globals.css'],
    ['app/(app)/kunden/page.tsx'],
    ['package.json'],
  ]) {
    expect(select(changed)).not.toContain('audit:visual');
  }
  // A failed visual run neither starts repair mode nor returns in a change plan; its repair runs with --group.
  expect(browserOnly(select(['lib/inventory/b.ts'], ['audit:visual']))).toEqual([
    ...CRITICAL,
    'audit:wave-2:p1-13',
  ]);
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

test('the plan names a wall-clock group whose scope owns a changed product file, without selecting it', () => {
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

test('a release-only group runs in a change plan only when its own spec or test support changed', () => {
  const lab = browser(
    'audit:lab:office',
    'release-only',
    ['planning'],
    ['tests/audit/lab/office.spec.ts', 'lib/testing/lab-steps.ts'],
  );
  const withLab = [...groups, lab];
  const plan = (changedFiles: string[], unresolvedGroupIds: string[] = []): Map<string, unknown> =>
    groupSelections({ mode: 'change', groups: withLab, changedFiles, unresolvedGroupIds });
  // Its scope owns the file, yet the lab, layout and visual groups wait for a full run.
  const owned = plan([
    'components/kalender/board/board-row.tsx',
    'lib/work/actions.ts',
    'components/ui/button.tsx',
  ]);
  for (const id of ['audit:lab:office', 'audit:layout', 'audit:layout:work', 'audit:visual'])
    expect([id, owned.has(id)]).toEqual([id, false]);
  expect(plan(['lib/testing/lab-steps.ts']).get('audit:lab:office')).toEqual({
    reason: 'Test execution dependency changed',
    changedFiles: ['lib/testing/lab-steps.ts'],
  });
  expect(browserOnly([...plan(['tests/audit/layout/surfaces-work.spec.ts']).keys()])).toEqual([
    'audit:layout:work',
  ]);
  expect(browserOnly([...plan(['tests/audit/visual/references.spec.ts']).keys()])).toEqual(['audit:visual']);
  // A wall-clock group runs on a quiet machine with --group only, even when its own spec changed.
  expect(plan(['tests/audit/performance/calendar.spec.ts']).has('audit:performance:calendar')).toBe(false);
  // A failed release-only group is passed again with --group; it starts no repair mode.
  expect(browserOnly([...plan(['lib/inventory/b.ts'], ['audit:lab:office']).keys()])).toEqual([
    ...CRITICAL,
    'audit:wave-2:p1-13',
  ]);
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
