// CI runs the browser groups a change can break, and everything when it cannot tell.
import { expect, test } from 'bun:test';
import { ciPlan, MAX_SHARDS, type CiGroup } from './ci-plan';

const group = (id: string, file: string, scopes: string[]): CiGroup => ({
  id,
  kind: id.startsWith('golden:') ? 'golden' : (id.split(':')[0] ?? 'audit'),
  files: [file],
  scopes,
  executionInputs: [file],
});
const groups: CiGroup[] = [
  group('static:lint', 'eslint.config.mjs', ['*']),
  group('golden:gg-00', 'tests/golden/gg-00.spec.ts', ['*']),
  group('golden:p1-04', 'tests/golden/p1-04.spec.ts', ['personnel', 'time']),
  group('audit:wave-2:p1-13', 'tests/audit/wave-2/p1-13.spec.ts', ['work', 'inventory']),
  group('audit:performance:calendar', 'tests/audit/performance/calendar.spec.ts', ['planning']),
  group('audit:visual', 'tests/audit/visual/references.spec.ts', ['*']),
];
const ids = (plan: ReturnType<typeof ciPlan>): string[] => plan.browser.map((entry) => entry.id);
const EVERY_BROWSER_GROUP = ['golden:gg-00', 'golden:p1-04', 'audit:wave-2:p1-13', 'audit:visual'];

test('an unreadable diff and a tooling change run every browser group except the wall-clock ones', () => {
  const unreadable = ciPlan({ groups, changedFiles: undefined, fullRun: undefined });
  expect(unreadable.fullReason).toBe('The diff against the base could not be read');
  expect(ids(unreadable)).toEqual(EVERY_BROWSER_GROUP);
  for (const tooling of ['bun.lock', '.github/workflows/ci.yml', 'lib/testing/runner/app-port.ts'])
    expect(ids(ciPlan({ groups, changedFiles: [tooling], fullRun: undefined }))).toEqual(EVERY_BROWSER_GROUP);
  const nightly = ciPlan({ groups, changedFiles: [], fullRun: 'Nightly run' });
  expect(nightly.fullReason).toBe('Nightly run');
  expect(ids(nightly)).toEqual(EVERY_BROWSER_GROUP);
});

test('a pull request runs the browser groups its changed files select', () => {
  const plan = ciPlan({ groups, changedFiles: ['lib/inventory/stock.ts'], fullRun: undefined });
  expect(plan.fullReason).toBeUndefined();
  expect(ids(plan)).toEqual(['audit:wave-2:p1-13']);
  expect(ids(ciPlan({ groups, changedFiles: ['docs/README.md'], fullRun: undefined }))).toEqual([]);
  expect(ciPlan({ groups, changedFiles: ['docs/README.md'], fullRun: undefined }).shards).toEqual([]);
});

test('a change to rendered UI adds the visual groups, never the wall-clock ones', () => {
  const plan = ciPlan({
    groups,
    changedFiles: ['app/(app)/zeiterfassung/page.tsx'],
    fullRun: undefined,
  });
  expect(ids(plan)).toContain('audit:visual');
  expect(ids(plan)).not.toContain('audit:performance:calendar');
});

test('shards hold every selected group once and never exceed the job budget', () => {
  const many = Array.from({ length: 100 }, (_, index) =>
    group(`audit:many:${index}`, `tests/audit/many/${index}.spec.ts`, ['*']),
  );
  const plan = ciPlan({ groups: many, changedFiles: undefined, fullRun: undefined });
  expect(plan.shards).toHaveLength(MAX_SHARDS);
  const dealt = plan.shards.flatMap((shard) => shard.groups.split(','));
  expect(dealt.sort()).toEqual(many.map((entry) => entry.id).sort());
  const one = ciPlan({ groups, changedFiles: ['lib/inventory/stock.ts'], fullRun: undefined });
  expect(one.shards).toEqual([{ shard: 1, groups: 'audit:wave-2:p1-13' }]);
});
