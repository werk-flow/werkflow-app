import { describe, expect, test } from 'bun:test';

import { isMaintenanceDueOverdue } from './overdue';
import type { MaintenanceDueStatus } from './types';

describe('a due item is überfällig only when owed and due before today in Berlin', () => {
  const cases: Array<[string, string, MaintenanceDueStatus, string, boolean]> = [
    ['due yesterday at a month end', '2026-10-31', 'open', '2026-11-01', true],
    ['due today itself', '2026-11-14', 'open', '2026-11-14', false],
    ['due tomorrow', '2026-11-15', 'visit_created', '2026-11-14', false],
    ['due on a leap day, seen the day after', '2028-02-29', 'open', '2028-03-01', true],
    ['due on a leap day, seen that day', '2028-02-29', 'visit_created', '2028-02-29', false],
    ['due across a year end', '2026-12-31', 'visit_created', '2027-01-01', true],
    ['completed in the past', '2026-01-15', 'completed', '2026-11-14', false],
    ['skipped in the past', '2026-01-15', 'skipped', '2026-11-14', false],
    ['cancelled in the past', '2026-01-15', 'cancelled', '2026-11-14', false],
    ['superseded in the past', '2026-01-15', 'superseded', '2026-11-14', false],
  ];
  test.each(cases)('%s', (_name, dueDate, status, today, expected) => {
    expect(isMaintenanceDueOverdue({ dueDate, status }, today)).toBe(expected);
  });
});
