import { describe, expect, test } from 'bun:test';

import { getMemberActionErrorMessage, getResponsibilityRemovalBlockMessage } from './errors';

const FALLBACK_MESSAGE = 'Die Änderung konnte nicht gespeichert werden.';

describe('getMemberActionErrorMessage', () => {
  test('translates the known action error codes', () => {
    expect(getMemberActionErrorMessage('cannot_remove_self')).toBe('Du kannst dich nicht selbst entfernen.');
    expect(getMemberActionErrorMessage('cannot_change_own_role')).toBe(
      'Du kannst deine eigene Rolle nicht ändern.',
    );
    expect(getMemberActionErrorMessage('insufficient_permissions')).toBe(
      'Du darfst dieses Mitglied nicht verwalten.',
    );
    expect(getMemberActionErrorMessage('has_time_history')).toContain('bereits Arbeitszeit erfasst');
    expect(getMemberActionErrorMessage('exit_before_entry')).toContain('Eintrittsdatum');
  });

  test('falls back to a general message for an unknown or missing code', () => {
    expect(getMemberActionErrorMessage('unexpected_error')).toBe(FALLBACK_MESSAGE);
    expect(getMemberActionErrorMessage('')).toBe(FALLBACK_MESSAGE);
    expect(getMemberActionErrorMessage(undefined)).toBe(FALLBACK_MESSAGE);
  });

  test('names the one responsibility the member is the last holder of', () => {
    expect(getMemberActionErrorMessage('last_responsibility_holder:leave_approval')).toBe(
      'Vor dem Entfernen muss die Verantwortung für Urlaubsfreigaben neu zugewiesen oder auf den Standard zurückgestellt werden.',
    );
    expect(getMemberActionErrorMessage('last_responsibility_holders:time_approval')).toBe(
      'Vor dem Entfernen muss die Verantwortung für Zeitfreigaben neu zugewiesen oder auf den Standard zurückgestellt werden.',
    );
  });

  test('lists several stranded responsibilities in the order given', () => {
    expect(getMemberActionErrorMessage('last_responsibility_holders:time_approval,leave_approval')).toBe(
      'Vor dem Entfernen müssen diese Verantwortlichkeiten neu zugewiesen oder auf den Standard zurückgestellt werden: Zeitfreigaben, Urlaubsfreigaben.',
    );
  });
});

describe('getResponsibilityRemovalBlockMessage', () => {
  test('reports no block when nothing would be stranded', () => {
    expect(getResponsibilityRemovalBlockMessage([])).toBeNull();
  });

  test('uses the same wording as the action error for one and for several responsibilities', () => {
    expect(getResponsibilityRemovalBlockMessage(['work_handover_review'])).toBe(
      getMemberActionErrorMessage('last_responsibility_holder:work_handover_review'),
    );
    expect(getResponsibilityRemovalBlockMessage(['time_approval', 'work_artifact_approval'])).toBe(
      getMemberActionErrorMessage('last_responsibility_holders:time_approval,work_artifact_approval'),
    );
  });
});
