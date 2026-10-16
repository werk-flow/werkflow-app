import { describe, expect, test } from 'bun:test';

import { SHARED_FAILURE_MESSAGES } from '@/lib/action-messages';
import { getMemberActionErrorMessage, getResponsibilityRemovalBlockMessage } from './errors';

const FALLBACK_MESSAGE = 'Die Änderung konnte nicht gespeichert werden.';
const failure = (error: string) => ({ success: false as const, error });

describe('getMemberActionErrorMessage', () => {
  test('translates the known action error codes', () => {
    expect(getMemberActionErrorMessage(failure('cannot_remove_self'))).toBe(
      'Du kannst dich nicht selbst entfernen.',
    );
    expect(getMemberActionErrorMessage(failure('cannot_change_own_role'))).toBe(
      'Du kannst deine eigene Rolle nicht ändern.',
    );
    expect(getMemberActionErrorMessage(failure('insufficient_permissions'))).toBe(
      'Du darfst dieses Mitglied nicht verwalten.',
    );
    expect(getMemberActionErrorMessage(failure('has_time_history'))).toContain('bereits Arbeitszeit erfasst');
    expect(getMemberActionErrorMessage(failure('exit_before_entry'))).toContain('Eintrittsdatum');
  });

  test('a shared code takes its shared sentence; an unknown code or no answer the general message', () => {
    expect(getMemberActionErrorMessage(failure('not_authorized'))).toBe(
      SHARED_FAILURE_MESSAGES.not_authorized,
    );
    expect(getMemberActionErrorMessage(failure('member_not_found'))).toBe(FALLBACK_MESSAGE);
    expect(getMemberActionErrorMessage(null)).toBe(FALLBACK_MESSAGE);
  });

  test('names the one responsibility the member is the last holder of', () => {
    expect(
      getMemberActionErrorMessage({
        success: false,
        error: 'last_responsibility_holder',
        responsibilities: ['leave_approval'],
      }),
    ).toBe(
      'Vor dem Entfernen muss die Verantwortung für Urlaubsfreigaben neu zugewiesen oder auf den Standard zurückgestellt werden.',
    );
  });

  test('lists several stranded responsibilities in the order given', () => {
    expect(
      getMemberActionErrorMessage({
        success: false,
        error: 'last_responsibility_holder',
        responsibilities: ['time_approval', 'leave_approval'],
      }),
    ).toBe(
      'Vor dem Entfernen müssen diese Verantwortlichkeiten neu zugewiesen oder auf den Standard zurückgestellt werden: Zeitfreigaben, Urlaubsfreigaben.',
    );
  });
});

describe('getResponsibilityRemovalBlockMessage', () => {
  test('reports no block when nothing would be stranded', () => {
    expect(getResponsibilityRemovalBlockMessage([])).toBeNull();
  });

  test('uses the same wording as the action error for one and for several responsibilities', () => {
    for (const responsibilities of [
      ['work_handover_review'],
      ['time_approval', 'work_artifact_approval'],
    ] as const) {
      expect(getResponsibilityRemovalBlockMessage([...responsibilities])).toBe(
        getMemberActionErrorMessage({
          success: false,
          error: 'last_responsibility_holder',
          responsibilities: [...responsibilities],
        }),
      );
    }
  });
});
