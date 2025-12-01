import type { OrgRole } from '@/lib/members/actions';

/**
 * German role labels with gender-inclusive format
 */
export const ROLE_LABELS: Record<OrgRole, string> = {
  admin: 'Admin',
  manager: 'Manager/in',
  accountant: 'Buchhalter/in',
  secretary: 'Sekretär/in',
  employee: 'Mitarbeiter/in'
};

/**
 * Get the German label for a role
 */
export function getRoleLabel(role: OrgRole | string): string {
  return ROLE_LABELS[role as OrgRole] || role;
}

