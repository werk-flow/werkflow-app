import type {
  PersonnelAccessTransitionKind,
  PersonnelDocumentAccessClass,
  PersonnelEmploymentTransitionKind,
  PersonnelRequirementType,
} from '@/lib/personnel/lifecycle';

export const ACCESS_TRANSITIONS: Array<{
  value: PersonnelAccessTransitionKind;
  label: string;
}> = [
  { value: 'schedule_activation', label: 'Zugang planen' },
  { value: 'activate_now', label: 'Jetzt aktivieren' },
  { value: 'suspend_now', label: 'Sofort sperren' },
  { value: 'schedule_suspension', label: 'Sperre planen' },
  { value: 'cancel_scheduled', label: 'Planung zurücknehmen' },
  { value: 'reactivate', label: 'Reaktivieren' },
  { value: 'end_access', label: 'Zugang beenden' },
];

export const EMPLOYMENT_TRANSITIONS: Array<{
  value: PersonnelEmploymentTransitionKind;
  label: string;
}> = [
  { value: 'plan_start', label: 'Eintritt planen' },
  { value: 'start', label: 'Beschäftigung starten' },
  { value: 'record_notice', label: 'Austritt vormerken' },
  { value: 'plan_exit', label: 'Austritt planen' },
  { value: 'mark_inactive', label: 'Inaktiv setzen' },
  { value: 'exit', label: 'Austritt festhalten' },
  { value: 'cancel_scheduled', label: 'Planung zurücknehmen' },
  { value: 'reverse', label: 'Übergang rückgängig machen' },
  { value: 'reactivate', label: 'Beschäftigung reaktivieren' },
];

export const REQUIREMENT_TYPES: Array<{
  value: PersonnelRequirementType;
  label: string;
}> = [
  { value: 'document', label: 'Dokument' },
  { value: 'qualification', label: 'Qualifikation' },
  { value: 'employment_condition', label: 'Beschäftigungsbedingung' },
  { value: 'work_schedule', label: 'Arbeitszeitmodell' },
  { value: 'team', label: 'Team' },
  { value: 'access', label: 'Zugang' },
  { value: 'acknowledgement', label: 'Bestätigung' },
  { value: 'manual', label: 'Manueller Punkt' },
];

export const ACCESS_CLASS_OPTIONS: Array<{
  value: PersonnelDocumentAccessClass;
  label: string;
  description: string;
}> = [
  {
    value: 'personnel_standard',
    label: 'Personalunterlage',
    description: 'Admin und Büro; Freigabe an die betroffene Person möglich',
  },
  {
    value: 'admin_restricted',
    label: 'Nur Admin',
    description: 'Verträge oder besonders sensible Personalunterlagen',
  },
  {
    value: 'health_evidence',
    label: 'Gesundheitsnachweis',
    description: 'Minimaler Nachweis mit besonders enger Sichtbarkeit',
  },
];

export function isScheduledAccessTransition(kind: PersonnelAccessTransitionKind): boolean {
  return kind === 'schedule_activation' || kind === 'schedule_suspension';
}
