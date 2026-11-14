import { describe, expect, test } from 'bun:test';

import {
  dueActionErrorsById,
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
  defectsText: '',
  nextAction: null,
  nextActionOwnerId: '',
  nextActionTargetDate: '',
  nextActionNote: '',
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

  test('an unfinished visit marks its Mängel, next step, owner and target date, Mängel first', () => {
    const unfinished: MaintenanceDueActionValues = {
      ...VALUES,
      action: 'complete',
      scopeOutcome: 'unresolved',
      evidenceIds: ['revision'],
      reason: 'Nicht erledigt',
    };
    const errors = missing(unfinished);
    expect(Object.keys(errors).sort()).toEqual(['defects', 'nextAction']);
    expect(Object.entries(dueActionErrorsById(errors)).find(([, error]) => error)?.[0]).toBe('due-defects');
    const named: MaintenanceDueActionValues = {
      ...unfinished,
      defectsText: 'Brenner zündet verzögert\n\n',
      nextAction: 'return_visit',
    };
    expect(Object.keys(missing(named)).sort()).toEqual(['nextActionOwnerId', 'nextActionTargetDate']);
    expect(
      missing({ ...named, nextActionOwnerId: 'owner', nextActionTargetDate: '2026-11-14' }),
    ).toHaveProperty('nextActionTargetDate');
    expect(missing({ ...named, nextActionOwnerId: 'owner', nextActionTargetDate: '2026-11-30' })).toEqual({});
    expect(missing({ ...named, nextAction: 'none' })).toEqual({
      nextActionNote: 'Bitte begründe mit mindestens 3 Zeichen, warum nichts folgt.',
    });
    expect(missing({ ...named, defectsText: 'ab' })).toHaveProperty('defects');
    expect(missing({ ...named, nextAction: 'none', nextActionNote: 'x'.repeat(1001) })).toHaveProperty(
      'nextActionNote',
    );
  });

  test('a complete visit asks for no Mängel and no next step', () => {
    expect(missing({ ...VALUES, action: 'complete', evidenceIds: ['revision'], reason: 'Erledigt' })).toEqual(
      {},
    );
  });
});
