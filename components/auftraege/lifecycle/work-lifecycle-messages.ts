import { describeFailure } from '@/lib/action-messages';

const ERROR_MESSAGES = {
  work_transition_stale_version:
    'Der Arbeitsstand wurde inzwischen geändert. Die aktuelle Ansicht wurde geladen.',
  work_transition_not_allowed: 'Dieser Zustandswechsel ist nicht erlaubt.',
  work_transition_not_authorized: 'Du hast keine Berechtigung für diesen Zustandswechsel.',
  work_transition_reason_required: 'Bitte gib einen nachvollziehbaren Grund an.',
  work_transition_start_blocked: 'Offene Blocker oder Startvoraussetzungen verhindern den Start.',
  work_transition_completion_blocked: 'Die Abschlussprüfungen sind noch nicht erfüllt.',
  work_transition_handover_requires_override:
    'Die Übergabe enthält noch nicht prüfbare Punkte. Bestätige die begründete Ausnahme.',
  work_blocker_stale_version: 'Der Blocker wurde inzwischen geändert.',
  work_dependency_stale_version: 'Die Voraussetzung wurde inzwischen geändert.',
  work_dependency_cycle: 'Abhängigkeiten dürfen keinen Kreis bilden.',
  work_dependency_self: 'Arbeit kann nicht von sich selbst abhängen.',
  work_action_failed: 'Die Änderung konnte nicht gespeichert werden.',
} satisfies Record<string, string>;

/** The German sentence for a work-lifecycle action error code, or the generic save failure. */
export function workLifecycleErrorMessage(code: string): string {
  return describeFailure(code, ERROR_MESSAGES, ERROR_MESSAGES.work_action_failed);
}

// Read failures inside the dialogs are not save failures; they get their own copy.
export const PREDECESSOR_SEARCH_FAILED_MESSAGE =
  'Die Suche konnte gerade nicht ausgeführt werden. Tippe erneut, um es noch einmal zu versuchen.';
export const APPROVALS_LOAD_FAILED_MESSAGE = 'Die Freigaben konnten nicht geladen werden.';
