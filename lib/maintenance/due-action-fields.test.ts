import { describe, expect, test } from 'bun:test';

import {
  dueActionReasonRequired,
  missingDueActionFields,
  type MaintenanceDueActionValues,
} from './due-action-fields';

const VALUES: MaintenanceDueActionValues = {
  action: 'visit_missed',
  reason: '',
  date: '2026-11-20',
  time: '08:00',
  durationHours: '2',
  scopeOutcome: 'complete',
  completedOn: '2026-11-14',
  evidenceIds: [],
  serviceCaseId: '',
  missedReason: 'customer_absent',
};

const missing = (values: MaintenanceDueActionValues) =>
  missingDueActionFields(values, dueActionReasonRequired(values));

describe('the due action dialog asks only for what the chosen action sends', () => {
  test('a missed visit needs a note only for „Anderer Grund“', () => {
    expect(missing(VALUES)).toEqual({});
    expect(missing({ ...VALUES, missedReason: 'other' })).toHaveProperty('reason');
    expect(missing({ ...VALUES, missedReason: 'other', reason: 'Schlüssel fehlte' })).toEqual({});
  });

  test('a filled note under three characters is marked where the dialog shows it', () => {
    expect(missing({ ...VALUES, reason: 'ab' })).toHaveProperty('reason');
  });

  test('a short note left from another action never blocks scheduling, which hides it', () => {
    expect(missing({ ...VALUES, action: 'schedule', reason: 'ab' })).toEqual({});
  });
});
