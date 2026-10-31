'use client';

import { useState } from 'react';

import { usePendingTask } from '@/hooks/use-server-action';
import { useBanner } from '@/components/ui/banner';
import { describeFailure, SHARED_FAILURE_MESSAGES, type FailureSentence } from '@/lib/action-messages';
import { getTimeEntries } from '@/lib/time-tracking/entry-read-actions';
import { addManualEntry } from '@/lib/time-tracking/entry-write-actions';
import { isDateInClosedPeriod, type ClosedTimePeriod } from '@/lib/time-tracking/closed-period-dates';
import { validateManualEntries } from '@/lib/time-tracking/validation';
import {
  describeTimeValidationFailure,
  TIME_VALIDATION_MESSAGES,
} from '@/lib/time-tracking/validation-messages';
import type { AddManualEntryResult, ManualEntryInput, TimeEntry } from '@/lib/time-tracking/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { toLocalDateString } from '@/lib/utils';
import type { ManualEntryMode } from '@/components/use-manual-entry-form-draft';

const MANUAL_ENTRY_ERROR_MESSAGES: Readonly<Partial<Record<string, string | FailureSentence>>> = {
  ...TIME_VALIDATION_MESSAGES,
  target_not_a_member: 'Der ausgewählte Mitarbeiter ist kein Mitglied dieser Organisation.',
  validation_failed: 'Die Validierung ist fehlgeschlagen.',
  insert_failed: 'Der Eintrag konnte nicht gespeichert werden.',
  job_not_found:
    'Der Auftrag wurde in dieser Organisation nicht gefunden. Wähle einen anderen Auftrag oder trage die Zeit ohne Auftrag ein.',
  job_not_assigned:
    'Die ausgewählte Person ist diesem Auftrag nicht zugewiesen. Wähle einen ihrer Aufträge oder trage die Zeit ohne Auftrag ein.',
};

type ManualEntryFieldErrors = { member: string | undefined; date: string | undefined };

const NO_MANUAL_ENTRY_FIELD_ERRORS: ManualEntryFieldErrors = { member: undefined, date: undefined };

type ManualEntrySubmitInput = {
  activeOrgId: string | null;
  isAdmin: boolean;
  isAdminOrManager: boolean;
  currentUserId: string | null;
  entryMode: ManualEntryMode;
  selectedDate: Date | undefined;
  clockInTime: string;
  clockOutTime: string;
  selectedUserId: string;
  canAssignJob: boolean;
  selectedJobId: string;
  /** A date in a closed period is refused with `period_closed`; the form marks it first. */
  closedPeriods: readonly ClosedTimePeriod[];
  onSuccess: ((entries: TimeEntry[]) => void | Promise<void>) | undefined;
};

/** The clock-in and clock-out entries the form's mode asks for, on the chosen day. */
function buildManualEntries(
  entryMode: ManualEntryMode,
  dateIso: string,
  clockInTime: string,
  clockOutTime: string,
): ManualEntryInput[] {
  const entries: ManualEntryInput[] = [];

  if (entryMode === 'clock_in' || entryMode === 'both') {
    const clockInTimestamp = new Date(`${dateIso}T${clockInTime}:00`).toISOString();
    entries.push({ entryType: 'clock_in', timestamp: clockInTimestamp });
  }

  if (entryMode === 'clock_out' || entryMode === 'both') {
    const clockOutTimestamp = new Date(`${dateIso}T${clockOutTime}:00`).toISOString();
    entries.push({ entryType: 'clock_out', timestamp: clockOutTimestamp });
  }

  return entries;
}

/** The sentence for a refused save; a session open in another organization names that organization. */
function describeManualEntryFailure(
  result: Exclude<AddManualEntryResult, { success: true }>,
  targetUserId: string,
  currentUserId: string | null,
): string {
  if (
    result.error === 'working_in_other_org' &&
    'otherOrgName' in result &&
    typeof result.otherOrgName === 'string'
  ) {
    const isSelf = targetUserId === currentUserId;
    const title = isSelf
      ? 'Bereits in anderer Organisation eingestempelt'
      : 'Mitarbeiter ist bereits in anderer Organisation eingestempelt';
    const message = isSelf
      ? `Du bist aktuell in „${result.otherOrgName}“ eingestempelt. Bitte stemple dort zuerst aus, bevor du hier startest.`
      : `Der ausgewählte Mitarbeiter ist aktuell in „${result.otherOrgName}“ eingestempelt. Bitte zuerst dort ausstempeln, bevor hier eine offene Arbeitszeit gestartet wird.`;

    // One failure, one surface: the inline error carries the full
    // explanation (the earlier extra top banner double-reported it).
    return `${title}: ${message}`;
  }
  return describeFailure(result, MANUAL_ENTRY_ERROR_MESSAGES, 'Der Eintrag konnte nicht gespeichert werden.');
}

/**
 * Checks the entries against the person's day, then saves them; reports a
 * refusal inline and a saved entry with a banner.
 */
async function saveManualEntries({
  organizationId,
  targetUserId,
  currentUserId,
  dateIso,
  entries,
  isAdmin,
  canAssignJob,
  selectedJobId,
  setError,
  showBanner,
  onSuccess,
}: {
  organizationId: string;
  targetUserId: string;
  currentUserId: string | null;
  dateIso: string;
  entries: ManualEntryInput[];
  isAdmin: boolean;
  canAssignJob: boolean;
  selectedJobId: string;
  setError: (error: string | null) => void;
  showBanner: ReturnType<typeof useBanner>['showBanner'];
  onSuccess: ManualEntrySubmitInput['onSuccess'];
}): Promise<void> {
  const dayStart = new Date(dateIso);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dateIso);
  dayEnd.setHours(23, 59, 59, 999);

  const existingResult = await getTimeEntries({
    organizationId,
    from: dayStart.toISOString(),
    to: dayEnd.toISOString(),
    userId: targetUserId,
  });

  let existingEntries: TimeEntry[] = [];
  if (existingResult.success) existingEntries = existingResult.entries;

  const validationResult = validateManualEntries(existingEntries, entries, {
    allowFutureTimestamps: isAdmin,
  });
  if (!validationResult.valid) {
    setError(describeTimeValidationFailure(validationResult.failure));
    return;
  }

  const result = await addManualEntry({
    organizationId,
    targetUserId,
    entries,
    ...(canAssignJob && selectedJobId ? { jobId: selectedJobId } : {}),
  });

  if (result.success) {
    const isPendingResult = result.entries.some((e) => e.status === 'pending');
    showBanner({
      variant: 'success',
      message: isPendingResult
        ? 'Antrag wurde zur Genehmigung eingereicht.'
        : 'Eintrag erfolgreich erstellt!',
    });
    await onSuccess?.(result.entries);
  } else {
    setError(describeManualEntryFailure(result, targetUserId, currentUserId));
  }
}

/** Validates the manual entry form, saves the entries and reports the outcome. */
export function useManualEntrySubmit({
  activeOrgId,
  isAdmin,
  isAdminOrManager,
  currentUserId,
  entryMode,
  selectedDate,
  clockInTime,
  clockOutTime,
  selectedUserId,
  canAssignJob,
  selectedJobId,
  closedPeriods,
  onSuccess,
}: ManualEntrySubmitInput): {
  handleSubmit: (e: React.FormEvent) => Promise<void>;
  isPending: boolean;
  error: string | null;
  fieldErrors: ManualEntryFieldErrors;
} {
  const { run: runPendingTask, isPending } = usePendingTask();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ManualEntryFieldErrors>(NO_MANUAL_ENTRY_FIELD_ERRORS);
  const { showBanner } = useBanner();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors(NO_MANUAL_ENTRY_FIELD_ERRORS);

    if (!activeOrgId) {
      setError('Keine Organisation ausgewählt.');
      return;
    }

    const memberError =
      isAdminOrManager && !selectedUserId ? 'Bitte wähle einen Mitarbeiter aus.' : undefined;
    const dateIso = selectedDate ? toLocalDateString(selectedDate) : null;
    const dateError = !dateIso
      ? 'Bitte wähle ein gültiges Datum.'
      : isDateInClosedPeriod(dateIso, closedPeriods)
        ? SHARED_FAILURE_MESSAGES.period_closed
        : undefined;
    setFieldErrors({ member: memberError, date: dateError });
    const errorsById = { 'manual-entry-member': memberError, 'manual-entry-date': dateError };
    if (focusFirstInvalidField(errorsById) || !dateIso) return;

    const targetUserId = isAdminOrManager ? selectedUserId : currentUserId;
    if (!targetUserId) {
      setError('Keine Benutzerinformation verfügbar.');
      return;
    }

    const entries = buildManualEntries(entryMode, dateIso, clockInTime, clockOutTime);

    void runPendingTask(async () => {
      try {
        await saveManualEntries({
          organizationId: activeOrgId,
          targetUserId,
          currentUserId,
          dateIso,
          entries,
          isAdmin,
          canAssignJob,
          selectedJobId,
          setError,
          showBanner,
          onSuccess,
        });
      } catch {
        setError(SHARED_FAILURE_MESSAGES.unexpected_error);
      }
    });
  };

  return { handleSubmit, isPending, error, fieldErrors };
}
