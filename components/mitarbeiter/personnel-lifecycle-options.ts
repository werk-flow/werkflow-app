import type {
  PersonnelAccessTransitionKind,
  PersonnelDocumentAccessClass,
  PersonnelEmploymentTransitionKind,
  PersonnelRequirementType,
} from '@/lib/personnel/lifecycle';
import { ACCESS_STEP_LABELS, EMPLOYMENT_STEP_LABELS } from '@/lib/personnel/lifecycle-steps';

/** One sentence per access step: what changes for the person when you save it. */
const ACCESS_STEP_EFFECTS: Record<PersonnelAccessTransitionKind, string> = {
  schedule_activation: 'Die Person kann sich ab dem gewählten Zeitpunkt in dieser Organisation anmelden.',
  activate_now: 'Die Person kann sich ab sofort in dieser Organisation anmelden.',
  suspend_now:
    'Vorübergehend: Die Person kann sich ab sofort nicht mehr anmelden, bis du den Zugang reaktivierst.',
  schedule_suspension: 'Der Zugang bleibt bis zum gewählten Zeitpunkt bestehen und wird dann gesperrt.',
  cancel_scheduled: 'Die geplante Änderung entfällt, der Zugang bleibt, wie er jetzt ist.',
  reactivate: 'Die Person kann sich ab sofort wieder in dieser Organisation anmelden.',
  end_access:
    'Zum Austritt: Die Person kann sich ab sofort nicht mehr anmelden, Personalakte und Verlauf bleiben erhalten.',
};

/** One sentence per employment step: what changes for the person when you save it. */
const EMPLOYMENT_STEP_EFFECTS: Record<PersonnelEmploymentTransitionKind, string> = {
  plan_start: 'Die Beschäftigung beginnt am gewählten Datum, bis dahin gilt „Eintritt geplant“.',
  start: 'Die Beschäftigung gilt sofort als aktiv, das gewählte Datum wird das Eintrittsdatum.',
  record_notice:
    'Die Kündigung liegt vor, das Austrittsdatum steht aber noch nicht fest; die Person bleibt beschäftigt.',
  plan_exit: 'Die Person bleibt bis dahin beschäftigt und ist ab dem gewählten Datum ausgeschieden.',
  mark_inactive: 'Die Beschäftigung ruht sofort, etwa bei einer Freistellung, ohne Austritt.',
  exit: 'Für einen Austritt, der schon wirksam ist: Die Person gilt sofort als ausgeschieden.',
  cancel_scheduled: 'Der geplante Übergang tritt nicht automatisch ein, der Status bleibt, wie er jetzt ist.',
  reverse:
    'Korrigiert einen irrtümlich erfassten Übergang: Die Person ist wieder aktiv beschäftigt, ohne Austrittsdatum.',
  reactivate:
    'Die Person kehrt zurück und ist sofort wieder aktiv beschäftigt, ein Austrittsdatum wird gelöscht.',
};

export type LifecycleStepOption<Kind extends string> = { value: Kind; label: string; description: string };

/** The dialog options of the access steps that fit, in their order. */
export function accessStepOptions(
  steps: readonly PersonnelAccessTransitionKind[],
): LifecycleStepOption<PersonnelAccessTransitionKind>[] {
  return steps.map((value) => ({
    value,
    label: ACCESS_STEP_LABELS[value],
    description: ACCESS_STEP_EFFECTS[value],
  }));
}

/** The dialog options of the employment steps that fit, in their order. */
export function employmentStepOptions(
  steps: readonly PersonnelEmploymentTransitionKind[],
): LifecycleStepOption<PersonnelEmploymentTransitionKind>[] {
  return steps.map((value) => ({
    value,
    label: EMPLOYMENT_STEP_LABELS[value],
    description: EMPLOYMENT_STEP_EFFECTS[value],
  }));
}

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
