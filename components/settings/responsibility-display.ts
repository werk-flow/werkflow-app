import { describeFailure } from '@/lib/action-messages';
import type { EffectiveResponsibilityHolder } from '@/lib/responsibilities/resolution';
import { formatResponsibilityPersonName, type ResponsibilityPerson } from '@/lib/responsibilities/types';
import { ROLE_LABELS } from '@/lib/roles';

export const ERROR_MESSAGES = {
  not_authorized: 'Nur der Admin kann Verantwortlichkeiten ändern.',
  organization_not_found: 'Die aktive Organisation wurde nicht gefunden.',
  load_failed: 'Die Verantwortlichkeiten konnten nicht geladen werden.',
  responsibility_configuration_changed:
    'Die Verantwortlichkeit wurde zwischenzeitlich geändert. Bitte prüfe die aktuelle Wirkung erneut.',
  responsibility_requires_active_holder: 'Mindestens eine aktive Person muss verantwortlich bleiben.',
  responsibility_holder_not_active_member:
    'Eine ausgewählte Person ist kein aktives Organisationsmitglied mehr.',
  responsibility_delegation_invalid_dates: 'Bitte wähle einen gültigen Zeitraum ab heute.',
  responsibility_delegator_not_current_holder: 'Die vertretene Person trägt diese Verantwortung nicht mehr.',
  responsibility_substitute_not_active_member: 'Die Vertretung ist kein aktives Organisationsmitglied mehr.',
  responsibility_delegation_same_person: 'Verantwortliche Person und Vertretung müssen verschieden sein.',
  responsibility_delegation_overlap:
    'Für diese Vertretung besteht in diesem Zeitraum bereits eine Überschneidung.',
  responsibility_delegation_not_found: 'Die Vertretung wurde nicht gefunden.',
  save_failed: 'Die Änderung konnte nicht gespeichert werden.',
} satisfies Record<string, string>;

/** The sentence for a responsibility action failure; shared codes such as `invalid_input` come from `describeFailure`. */
export function responsibilityErrorMessage(code: string): string {
  return describeFailure(code, ERROR_MESSAGES, ERROR_MESSAGES.save_failed);
}

export function personName(people: ResponsibilityPerson[], employeeRecordId: string): string {
  const person = people.find((candidate) => candidate.employeeRecordId === employeeRecordId);
  return person ? formatResponsibilityPersonName(person) : 'Unbekannte Person';
}

export function formatDelegationDate(value: string): string {
  return new Date(`${value}T12:00:00`).toLocaleDateString('de-DE');
}

export function holderSourceLabel(holder: EffectiveResponsibilityHolder): string {
  if (holder.source.kind === 'direct_assignment') return 'Direkt zugewiesen';
  if (holder.source.kind === 'delegation') {
    return `Vertretung bis ${formatDelegationDate(holder.source.validUntil)}`;
  }
  return `Standard: ${ROLE_LABELS[holder.source.role]}`;
}
