// Rule test: every surface group is a registered audit group, and every page, tab and dialog of the inventories runs in exactly one surface test.
import { expect, test } from 'bun:test';
import { resolve } from 'node:path';

import { dialogAuditTargets } from './dialog-inventory';
import { PAGE_TAB_SETS } from './page-tab-inventory';
import { SURFACE_GROUPS, surfaceTargets, surfaceTests } from './surface-groups';
import { getTestGroups } from './test-groups';

test('every surface group is registered with its own spec file', () => {
  const registered = new Map(
    getTestGroups(resolve(import.meta.dir, '../../..')).map((group) => [group.id, group.files]),
  );
  for (const group of SURFACE_GROUPS)
    expect(registered.get(`audit:layout:${group}`), group).toEqual([
      `tests/audit/layout/surfaces-${group}.spec.ts`,
    ]);
});

test('every group holds at least one test, and every page, tab and dialog runs exactly once', () => {
  const tests = SURFACE_GROUPS.flatMap((group) => {
    const groupTests = surfaceTests(group);
    expect(groupTests.length, group).toBeGreaterThan(0);
    return groupTests;
  });
  const titles = tests.map((surfaceTest) => surfaceTest.title);
  expect(new Set(titles).size).toBe(titles.length);

  const pages = SURFACE_GROUPS.flatMap((group) => surfaceTargets(group));
  const defaultViews = tests.filter((surfaceTest) => surfaceTest.defaultView);
  expect(defaultViews.map((surfaceTest) => `${surfaceTest.role} ${surfaceTest.route}`).sort()).toEqual(
    pages.map((page) => `${page.role} ${page.route}`).sort(),
  );

  const auditedTabs = tests.flatMap((surfaceTest) =>
    surfaceTest.tabs.map((tab) => `${surfaceTest.role} ${surfaceTest.route} ${tab}`),
  );
  expect(auditedTabs.sort()).toEqual(
    PAGE_TAB_SETS.flatMap((set) => set.tabs.map((tab) => `${set.role} ${set.route} ${tab}`)).sort(),
  );

  const auditedDialogs = tests.flatMap((surfaceTest) =>
    surfaceTest.dialogs.map((dialog) => `${dialog.role} ${dialog.route} ${dialog.opener}`),
  );
  expect(auditedDialogs.sort()).toEqual(
    dialogAuditTargets()
      .map((dialog) => `${dialog.role} ${dialog.route} ${dialog.opener}`)
      .sort(),
  );
});
