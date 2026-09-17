import type { OrgRole } from '@/lib/members/actions';
import type { InviteRole } from '@/lib/invites/actions';

/**
 * German role labels with gender-inclusive format
 */
export const ROLE_LABELS: Record<OrgRole, string> = {
  admin: 'Admin',
  buero: 'Büro',
  employee: 'Handwerker/in'
};

/** Roles an invitation may grant, labelled from the one label table. */
export const INVITE_ROLE_OPTIONS: { value: InviteRole; label: string }[] = (['buero', 'employee'] as const).map(
  (value) => ({ value, label: ROLE_LABELS[value] }),
);

/**
 * Get the German label for a role
 */
export function getRoleLabel(role: OrgRole | string): string {
  return ROLE_LABELS[role as OrgRole] || role;
}

