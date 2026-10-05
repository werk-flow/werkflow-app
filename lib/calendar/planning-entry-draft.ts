import { parseHoursInputToMinutes } from '@/lib/jobs/planned-working';
import { parseDecimalInput } from '@/lib/ui/decimal';

export type PlanningEntryKind = 'job_visit' | 'internal';
export type PlanningTimeKind = 'timed' | 'all_day';
export type PlanningRecurrenceFrequency = 'daily' | 'weekly' | 'monthly';
export type PlanningRecurrenceEndMode = 'count' | 'until';

/** The planning entry form's inputs as typed; numbers are still the user's text. */
export interface PlanningEntryDraft {
  entryKind: PlanningEntryKind;
  jobId: string;
  internalType: string;
  title: string;
  description: string;
  location: string;
  /** `YYYY-MM-DD`, empty while unset. */
  date: string;
  /** `HH:MM`. */
  time: string;
  timeKind: PlanningTimeKind;
  durationHours: string;
  durationDays: string;
  employeeRecordIds: readonly string[];
  teamIds: readonly string[];
  recurring: boolean;
  frequency: PlanningRecurrenceFrequency;
  interval: string;
  /** Monday-first weekday numbers, 0 to 6. */
  weekdays: readonly number[];
  endMode: PlanningRecurrenceEndMode;
  occurrenceCount: string;
  untilDate: string;
  hasConflicts: boolean;
  overrideReason: string;
}

/** The form's per-field messages; a key is present while its input is missing. */
export interface PlanningEntryFieldErrors {
  job?: string;
  title?: string;
  date?: string;
  override?: string;
}

type PlanningEntryDraftField = keyof PlanningEntryFieldErrors;

/** A required input the user left empty, in the form's visual order. */
export interface PlanningMissingInput<Field extends string> {
  field: Field;
  message: string;
  /** The element that takes the focus when this is the first missing input. */
  elementId: string;
}

/** The create request without the per-attempt idempotency key and override decision. */
interface PlanningEntryRequest {
  entryKind: PlanningEntryKind;
  internalType: string | null;
  jobId: string | null;
  title: string | null;
  description: string | null;
  location: string | null;
  timeKind: PlanningTimeKind;
  startsAtLocal: string;
  durationMinutes: number | null;
  durationDays: number | null;
  assignmentDrafts: Array<{ employeeRecordId: string; teamSourceId: null }>;
  teamIds: readonly string[];
  recurrence: {
    frequency: PlanningRecurrenceFrequency;
    interval: number;
    weekdays: readonly number[] | null;
    monthDay: number | null;
    occurrenceCount: number | null;
    untilLocalDate: string | null;
  } | null;
}

type PlanningEntryDraftCheck =
  | {
      kind: 'missing';
      inputs: [
        PlanningMissingInput<PlanningEntryDraftField>,
        ...PlanningMissingInput<PlanningEntryDraftField>[],
      ];
    }
  | { kind: 'invalid'; message: string }
  | { kind: 'ready'; request: PlanningEntryRequest };

/** Monday-first weekday (Monday 0, Sunday 6) of a `YYYY-MM-DD` date. */
export function getMondayWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 6 : day - 1;
}

/** The success message after a create planned one entry or a whole series. */
export function plannedEntriesMessage(occurrenceCount: number): string {
  return occurrenceCount === 1 ? 'Termin wurde geplant.' : `${occurrenceCount} Termine wurden geplant.`;
}

/** Required inputs in visual order; the first one takes the focus. */
function planningEntryMissingInputs(
  draft: PlanningEntryDraft,
): PlanningMissingInput<PlanningEntryDraftField>[] {
  const missing: PlanningMissingInput<PlanningEntryDraftField>[] = [];
  if (draft.entryKind === 'job_visit' && !draft.jobId)
    missing.push({ field: 'job', message: 'Bitte wähle einen Auftrag aus.', elementId: 'planning-job' });
  if (draft.entryKind === 'internal' && !draft.title.trim())
    missing.push({ field: 'title', message: 'Bitte gib einen Titel ein.', elementId: 'planning-title' });
  if (!draft.date)
    missing.push({ field: 'date', message: 'Bitte wähle ein Datum.', elementId: 'planning-date' });
  if (draft.hasConflicts && draft.overrideReason.trim().length < 8)
    missing.push({
      field: 'override',
      message: 'Bitte begründe die Abweichung mit mindestens 8 Zeichen.',
      elementId: 'planning-override',
    });
  return missing;
}

/**
 * Checks a planning entry draft in the form's order (missing inputs, then
 * duration, then recurrence) and builds the create request once it passes.
 */
export function checkPlanningEntryDraft(draft: PlanningEntryDraft): PlanningEntryDraftCheck {
  const [firstMissing, ...otherMissing] = planningEntryMissingInputs(draft);
  if (firstMissing) return { kind: 'missing', inputs: [firstMissing, ...otherMissing] };
  const durationMinutes = parseHoursInputToMinutes(draft.durationHours);
  const parsedDurationDays = parseDecimalInput(draft.durationDays);
  const parsedInterval = parseDecimalInput(draft.interval);
  const parsedOccurrenceCount = parseDecimalInput(draft.occurrenceCount);
  if (
    (draft.timeKind === 'timed' &&
      (durationMinutes === null || durationMinutes < 15 || durationMinutes > 168 * 60)) ||
    (draft.timeKind === 'all_day' &&
      (!Number.isInteger(parsedDurationDays) || parsedDurationDays < 1 || parsedDurationDays > 31))
  ) {
    return { kind: 'invalid', message: 'Bitte eine gültige Dauer angeben.' };
  }
  if (
    draft.recurring &&
    (!Number.isInteger(parsedInterval) ||
      parsedInterval < 1 ||
      parsedInterval > 12 ||
      (draft.endMode === 'count' &&
        (!Number.isInteger(parsedOccurrenceCount) ||
          parsedOccurrenceCount < 2 ||
          parsedOccurrenceCount > 730)))
  ) {
    return { kind: 'invalid', message: 'Bitte gültige Wiederholungswerte angeben.' };
  }
  // Key order is the request signature that keeps one idempotency key per unchanged request.
  const request: PlanningEntryRequest = {
    entryKind: draft.entryKind,
    internalType: draft.entryKind === 'internal' ? draft.internalType : null,
    jobId: draft.entryKind === 'job_visit' ? draft.jobId || null : null,
    title: draft.entryKind === 'internal' ? draft.title || null : null,
    description: draft.entryKind === 'internal' ? draft.description || null : null,
    location: draft.entryKind === 'internal' ? draft.location || null : null,
    timeKind: draft.timeKind,
    startsAtLocal: `${draft.date}T${draft.timeKind === 'timed' ? draft.time : '00:00'}`,
    durationMinutes: draft.timeKind === 'timed' ? durationMinutes : null,
    durationDays: draft.timeKind === 'all_day' ? parsedDurationDays : null,
    assignmentDrafts: draft.employeeRecordIds.map((employeeRecordId) => ({
      employeeRecordId,
      teamSourceId: null,
    })),
    teamIds: draft.teamIds,
    recurrence: draft.recurring
      ? {
          frequency: draft.frequency,
          interval: parsedInterval,
          weekdays: draft.frequency === 'weekly' ? draft.weekdays : null,
          monthDay: draft.frequency === 'monthly' ? Number(draft.date.slice(8, 10)) : null,
          occurrenceCount: draft.endMode === 'count' ? parsedOccurrenceCount : null,
          untilLocalDate: draft.endMode === 'until' ? draft.untilDate || null : null,
        }
      : null,
  };
  return { kind: 'ready', request };
}
