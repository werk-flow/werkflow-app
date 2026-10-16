import type { InviteRole } from '@/lib/invites/actions';
import { Constants, type Database } from '@/lib/supabase/database.types';

/** A member's role in an organization, as the database enum names it. */
export type OrgRole = Database['public']['Enums']['org_role'];

/** Whether a value from a form control names a role. */
export function isOrgRole(value: string): value is OrgRole {
  return Constants.public.Enums.org_role.some((role) => role === value);
}

/**
 * German role labels with gender-inclusive format
 */
export const ROLE_LABELS: Record<OrgRole, string> = {
  admin: 'Admin',
  buero: 'Büro',
  employee: 'Handwerker/in',
};

/** Roles an invitation may grant, labelled from the one label table. */
export const INVITE_ROLE_OPTIONS: { value: InviteRole; label: string }[] = (
  ['buero', 'employee'] as const
).map((value) => ({ value, label: ROLE_LABELS[value] }));

/** Admin and Büro manage other members' records; an employee manages only their own. */
export function isManagerRole(role: OrgRole): role is 'admin' | 'buero' {
  return role === 'admin' || role === 'buero';
}

/**
 * Get the German label for a role
 */
export function getRoleLabel(role: OrgRole): string {
  return ROLE_LABELS[role];
}
