import {
  RESPONSIBILITY_LABELS,
  type OrganizationResponsibility,
} from '@/lib/responsibilities/types';

const MEMBER_ACTION_ERROR_MESSAGES: Record<string, string> = {
  cannot_remove_self: 'Du kannst dich nicht selbst entfernen.',
  cannot_remove_admin: 'Der Organisationsadmin kann nicht entfernt werden.',
  cannot_change_admin_role:
    'Die Rolle des Organisationsadmins kann nicht geändert werden.',
  cannot_change_own_role: 'Du kannst deine eigene Rolle nicht ändern.',
  insufficient_permissions: 'Du darfst dieses Mitglied nicht verwalten.',
  delete_failed: 'Das Mitglied konnte nicht entfernt werden.',
  update_failed: 'Die Rolle konnte nicht geändert werden.',
};

function responsibilityRemovalMessage(
  responsibilities: OrganizationResponsibility[]
): string {
  if (responsibilities.length === 1) {
    return `Vor dem Entfernen muss die Verantwortung für ${RESPONSIBILITY_LABELS[responsibilities[0]]} neu zugewiesen oder auf den Standard zurückgestellt werden.`;
  }
  const labels = responsibilities
    .map((responsibility) => RESPONSIBILITY_LABELS[responsibility])
    .join(', ');
  return `Vor dem Entfernen müssen diese Verantwortlichkeiten neu zugewiesen oder auf den Standard zurückgestellt werden: ${labels}.`;
}

export function getMemberActionErrorMessage(error: string | undefined): string {
  if (error?.startsWith('last_responsibility_holder:')) {
    const responsibility = error.split(':')[1] as OrganizationResponsibility;
    return responsibilityRemovalMessage([responsibility]);
  }
  if (error?.startsWith('last_responsibility_holders:')) {
    const responsibilities = error
      .slice('last_responsibility_holders:'.length)
      .split(',')
      .filter(Boolean) as OrganizationResponsibility[];
    return responsibilityRemovalMessage(responsibilities);
  }
  return (
    MEMBER_ACTION_ERROR_MESSAGES[error ?? ''] ??
    'Die Änderung konnte nicht gespeichert werden.'
  );
}

export function getResponsibilityRemovalBlockMessage(
  responsibilities: OrganizationResponsibility[]
): string | null {
  if (responsibilities.length === 0) return null;
  return responsibilityRemovalMessage(responsibilities);
}
