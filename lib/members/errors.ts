import type { OrganizationResponsibility } from '@/lib/responsibilities/types';

export function getMemberActionErrorMessage(error: string | undefined): string {
  if (error === 'last_responsibility_holder:time_approval') {
    return 'Vor dem Entfernen muss die Verantwortung für Zeitfreigaben neu zugewiesen oder auf den Standard zurückgestellt werden.';
  }
  if (error === 'last_responsibility_holder:leave_approval') {
    return 'Vor dem Entfernen muss die Verantwortung für Urlaubsfreigaben neu zugewiesen oder auf den Standard zurückgestellt werden.';
  }

  const messages: Record<string, string> = {
    cannot_remove_self: 'Du kannst dich nicht selbst entfernen.',
    cannot_remove_admin: 'Der Organisationsadmin kann nicht entfernt werden.',
    cannot_change_admin_role:
      'Die Rolle des Organisationsadmins kann nicht geändert werden.',
    cannot_change_own_role: 'Du kannst deine eigene Rolle nicht ändern.',
    insufficient_permissions: 'Du darfst dieses Mitglied nicht verwalten.',
    delete_failed: 'Das Mitglied konnte nicht entfernt werden.',
    update_failed: 'Die Rolle konnte nicht geändert werden.',
  };
  return messages[error ?? ''] ?? 'Die Änderung konnte nicht gespeichert werden.';
}

export function getResponsibilityRemovalBlockMessage(
  responsibilities: OrganizationResponsibility[]
): string | null {
  if (responsibilities.length === 0) return null;
  if (responsibilities.length === 1) {
    return getMemberActionErrorMessage(
      `last_responsibility_holder:${responsibilities[0]}`
    );
  }
  return 'Vor dem Entfernen müssen die Verantwortlichkeiten für Zeitfreigaben und Urlaubsfreigaben neu zugewiesen oder auf den Standard zurückgestellt werden.';
}
