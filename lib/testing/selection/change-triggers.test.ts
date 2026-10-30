// Rule test: no browser permission test loses its trigger in a change plan.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expectDefined } from '../spec-support/expect-defined';
import { CRITICAL_JOURNEYS, ROLE_DENIAL_GROUPS } from './change-triggers';
import { getTestGroups, type TestGroup } from './test-groups';
import { declaredTitles } from './test-titles';

describe('change triggers', () => {
  const root = resolve(import.meta.dir, '../../..');
  const groups = getTestGroups(root);
  const browserGroups = groups.filter((group) => group.kind === 'golden' || group.kind === 'audit');
  const source = (group: TestGroup): string =>
    group.files.map((file) => readFileSync(resolve(root, file), 'utf8')).join('\n');

  test('the critical journeys are the owner-approved golden groups, and every role has one', () => {
    expect(
      browserGroups
        .filter((group) => group.changeTrigger === 'critical')
        .map((group) => group.id)
        .sort(),
    ).toEqual(Object.keys(CRITICAL_JOURNEYS).sort());
    expect(new Set(Object.values(CRITICAL_JOURNEYS).map((entry) => entry.role))).toEqual(
      new Set(['all', 'employee', 'buero', 'admin']),
    );
  });

  test('a browser group that drives a denial keeps a trigger beyond its own test code', () => {
    const denial =
      /\boutsiderPage\b|\bexpect(RedirectedAway|ExpiredResponsibilityDeniedAtAction|TimeApprovalsUnavailable|PendingTimeApprovalHidden)\b/;
    expect(
      browserGroups
        .filter((group) => group.changeTrigger === 'own-test' && denial.test(source(group)))
        .map((group) => group.id),
    ).toEqual([]);
    expect(groups.find((group) => group.id === 'audit:security:account')?.changeTrigger).toBe('scope');
  });

  test('each role denial row names a permission group, tests its spec declares, and the issue that moves them', () => {
    for (const [id, row] of Object.entries(ROLE_DENIAL_GROUPS)) {
      const group = expectDefined(
        groups.find((candidate) => candidate.id === id),
        `the registered group ${id}`,
      );
      expect([id, group.changeTrigger]).toEqual([id, 'scope']);
      // A group that drives an outsider session keeps its trigger without a row.
      expect([id, /\boutsiderPage\b/.test(source(group))]).toEqual([id, false]);
      const titles = new Set(
        group.files.flatMap((file) =>
          declaredTitles(file, readFileSync(resolve(root, file), 'utf8')).map((entry) => entry.title),
        ),
      );
      for (const title of row.tests) expect([id, title, titles.has(title)]).toEqual([id, title, true]);
      expect([id, row.movesIn]).toEqual([
        id,
        expect.stringMatching(/^werk-flow\/werkflow-planning#(3[6-9]|40)$/),
      ]);
    }
  });
});
