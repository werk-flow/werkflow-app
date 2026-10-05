import { expect, test } from 'bun:test';

import type { EffectiveResponsibilityHolder } from '@/lib/responsibilities/resolution';
import { correctionHistoryVisibility } from './history-visibility';

const holderWith = (source: EffectiveResponsibilityHolder['source']): EffectiveResponsibilityHolder => ({
  employeeRecordId: 'record-caller',
  userId: 'caller',
  source,
});
const delegation = (
  inheritedSource: Extract<
    EffectiveResponsibilityHolder['source'],
    { kind: 'delegation' }
  >['inheritedSource'],
) =>
  holderWith({
    kind: 'delegation',
    configurationId: null,
    delegationId: 'delegation',
    delegatedFromEmployeeRecordId: 'record-delegator',
    validFrom: '2026-01-01',
    validUntil: '2026-12-31',
    inheritedSource,
  });

test('admin and Büro read the whole history whatever they hold', () => {
  expect(correctionHistoryVisibility('admin', null)).toBe('all');
  expect(correctionHistoryVisibility('buero', null)).toBe('all');
});

test('an employee who reviews nobody reads only their own requests', () => {
  expect(correctionHistoryVisibility('employee', null)).toBe('own');
});

test('an employee reads the subjects their time approval reaches', () => {
  const buero = { kind: 'role_default', configurationId: null, role: 'buero' } as const;
  const admin = { kind: 'role_default', configurationId: null, role: 'admin' } as const;
  const direct = {
    kind: 'direct_assignment',
    configurationId: 'config',
    assignmentId: 'assignment',
  } as const;
  expect(correctionHistoryVisibility('employee', delegation(buero))).toBe('own_and_employee_subjects');
  expect(correctionHistoryVisibility('employee', delegation(admin))).toBe('all');
  expect(correctionHistoryVisibility('employee', delegation(direct))).toBe('all');
  expect(correctionHistoryVisibility('employee', holderWith(direct))).toBe('all');
});
