import { parseHoursInputToMinutes } from '@/lib/jobs/planned-working';
import type { UpdatePlanningCalendarInput } from '@/lib/planning/actions';
import type { PlanningConflict } from '@/lib/planning/types';
import type { PlanningMissingInput, PlanningTimeKind } from './planning-entry-draft';

/** Which occurrences of a series one edit changes. */
export type PlanningEditScope = 'one' | 'future' | 'series';
/** The status change the dialog is collecting a reason for. */
export type PlanningStatusIntent = 'skipped' | 'cancelled';

/** The occurrence edit dialog's per-field messages; a key is present while its input is missing or invalid. */
export interface PlanningOccurrenceFieldErrors {
  date?: string;
  duration?: string;
  reason?: string;
}

type PlanningOccurrenceField = keyof PlanningOccurrenceFieldErrors;

/** The occurrence edit dialog's inputs as typed, with the warnings of its last check. */
export interface PlanningOccurrenceEditDraft {
  /** `YYYY-MM-DD`, empty while unset. */
  date: string;
  /** `HH:MM`. */
  time: string;
  durationHours: string;
  /** The occurrence's own time kind; an all-day occurrence keeps its time and duration. */
  timeKind: PlanningTimeKind | undefined;
  employeeRecordIds: string[];
  conflicts: readonly PlanningConflict[];
  fingerprint: string | null;
  reason: string;
}

type PlanningOccurrenceEditCheck =
  | {
      kind: 'missing';
      inputs: [
        PlanningMissingInput<PlanningOccurrenceField>,
        ...PlanningMissingInput<PlanningOccurrenceField>[],
      ];
    }
  | { kind: 'ready'; input: UpdatePlanningCalendarInput };

/**
 * Checks an occurrence edit in visual order (date, duration, override reason)
 * and builds the update input once it passes.
 */
export function checkPlanningOccurrenceEdit(draft: PlanningOccurrenceEditDraft): PlanningOccurrenceEditCheck {
  const durationMinutes = parseHoursInputToMinutes(draft.durationHours);
  const durationInvalid =
    draft.timeKind !== 'all_day' &&
    (durationMinutes === null || durationMinutes < 15 || durationMinutes > 168 * 60);
  const missing: PlanningMissingInput<PlanningOccurrenceField>[] = [];
  if (!draft.date)
    missing.push({ field: 'date', message: 'Bitte wähle ein Datum.', elementId: 'planning-edit-date' });
  if (durationInvalid)
    missing.push({
      field: 'duration',
      message: 'Bitte eine gültige Dauer angeben.',
      elementId: 'planning-edit-duration',
    });
  if (draft.conflicts.length > 0 && draft.reason.trim().length < 8)
    missing.push({
      field: 'reason',
      message: 'Bitte begründe die Änderung mit mindestens 8 Zeichen.',
      elementId: 'planning-edit-reason',
    });
  const [firstMissing, ...otherMissing] = missing;
  if (firstMissing) return { kind: 'missing', inputs: [firstMissing, ...otherMissing] };
  return {
    kind: 'ready',
    input: {
      plannedDate: draft.date,
      ...(draft.timeKind === 'all_day' ? {} : { plannedTime: draft.time }),
      ...(draft.timeKind === 'all_day' || durationMinutes === null
        ? {}
        : { estimatedDurationMinutes: durationMinutes }),
      selectedEmployeeRecordIds: draft.employeeRecordIds,
      overrideReason: draft.conflicts.length ? draft.reason || null : null,
      assessmentFingerprint: draft.conflicts.length ? draft.fingerprint : null,
    },
  };
}

/** The success message of a saved edit, by how many occurrences it changed. */
export function planningEditSuccessMessage(scope: PlanningEditScope): string {
  return scope === 'one'
    ? 'Termin wurde angepasst.'
    : scope === 'future'
      ? 'Dieser und zukünftige Termine wurden angepasst.'
      : 'Alle noch änderbaren Serientermine wurden angepasst.';
}

/** The success message of a skipped or cancelled occurrence. */
export function planningStatusChangeMessage(status: PlanningStatusIntent): string {
  return status === 'skipped' ? 'Termin wurde ausgelassen.' : 'Termin wurde abgesagt.';
}
