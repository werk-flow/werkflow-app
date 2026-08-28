import type { Database } from '@/lib/supabase/database.types';

export type OrganizationResponsibility =
  Database['public']['Enums']['organization_responsibility'];
export type ResponsibilityConfigurationMode =
  Database['public']['Enums']['responsibility_configuration_mode'];
export type ResponsibilityAssignmentSource =
  Database['public']['Enums']['responsibility_assignment_source'];
export type OrgRole = Database['public']['Enums']['org_role'];

export const ORGANIZATION_RESPONSIBILITIES = [
  'time_approval',
  'leave_approval',
  'work_artifact_approval',
  'work_handover_review',
] as const satisfies readonly OrganizationResponsibility[];

export const RESPONSIBILITY_LABELS: Record<
  OrganizationResponsibility,
  string
> = {
  time_approval: 'Zeitfreigaben',
  leave_approval: 'Urlaubsfreigaben',
  work_artifact_approval: 'Arbeitsnachweise freigeben',
  work_handover_review: 'Übergaben prüfen',
};

export const RESPONSIBILITY_DESCRIPTIONS: Record<
  OrganizationResponsibility,
  string
> = {
  time_approval:
    'Erlaubt die Freigabe eingereichter Arbeitszeiten, ohne weitere Verwaltungsrechte zu vergeben.',
  leave_approval:
    'Legt fest, wer Urlaubsanträge freigeben darf, sobald der Urlaubsprozess verfügbar ist.',
  work_artifact_approval:
    'Legt fest, wer eingereichte Arbeitsnachweise nach dem Vier-Augen-Prinzip intern freigeben darf.',
  work_handover_review:
    'Legt fest, wer abgeschlossene Einsätze prüft, ein unveränderliches Übergabepaket freigibt und an das Büro übergibt.',
};

export type ResponsibilityPerson = {
  employeeRecordId: string;
  userId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  role: OrgRole;
};

export function formatResponsibilityPersonName(
  person: Pick<ResponsibilityPerson, 'firstName' | 'lastName' | 'email'>
): string {
  const name = [person.firstName, person.lastName].filter(Boolean).join(' ');
  return name || person.email || 'Unbekannte Person';
}
