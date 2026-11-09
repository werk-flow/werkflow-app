'use client';

import { useRef, useState } from 'react';

import { usePendingTask } from '@/hooks/use-server-action';
import { useBanner } from '@/components/ui/banner';
import { describeFailure, SHARED_FAILURE_MESSAGES, type FailureSentence } from '@/lib/action-messages';
import { getTimeEntries } from '@/lib/time-tracking/entry-read-actions';
import { addManualEntry } from '@/lib/time-tracking/entry-write-actions';
import { validateManualEntries } from '@/lib/time-tracking/validation';
import {
  describeTimeValidationFailure,
  TIME_VALIDATION_MESSAGES,
} from '@/lib/time-tracking/validation-messages';
import type { AddManualEntryResult, ManualEntryInput, TimeEntry } from '@/lib/time-tracking/types';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { PAST_DAY_EARLIER_VERSION_SAVED, submitPastDayTime } from '@/components/manual-entry-past-day';
import { sendUnderOperation, type CorrectionOperation } from '@/components/correction-operation';
import type { TimelineFact } from '@/lib/time-corrections/timeline';
import type { CorrectionTimelineHandle } from '@/components/zeiterfassung/time-correction-dialog-timeline-section';
import {
  manualEntryFieldIds,
  NO_MANUAL_ENTRY_FIELD_ERRORS,
  planManualEntrySubmission,
  type ManualEntryFieldErrors,
  type ManualEntryFormValues,
} from '@/components/manual-entry-submission';

const MANUAL_ENTRY_ERROR_MESSAGES: Readonly<Partial<Record<string, string | FailureSentence>>> = {
  ...TIME_VALIDATION_MESSAGES,
  target_not_a_member: 'Der ausgewählte Mitarbeiter ist kein Mitglied dieser Organisation.',
  validation_failed: 'Die Validierung ist fehlgeschlagen.',
  insert_failed: 'Der Eintrag konnte nicht gespeichert werden.',
  job_not_found:
    'Der Auftrag wurde in dieser Organisation nicht gefunden. Wähle einen anderen Auftrag oder trage die Zeit ohne Auftrag ein.',
  job_not_assigned:
    'Die ausgewählte Person ist diesem Auftrag nicht zugewiesen. Wähle einen ihrer Aufträge oder trage die Zeit ohne Auftrag ein.',
  past_day_needs_reason:
    'Für einen vergangenen Tag braucht die Freigabe einen Grund. Gib ihn an und speichere erneut.',
};

type ManualEntrySubmitInput = ManualEntryFormValues & {
  activeOrgId: string | null;
  isAdmin: boolean;
  currentUserId: string | null;
  canAssignJob: boolean;
  selectedJobId: string;
  /** The timeline own time of an earlier day carries; null until its section loaded. */
  timelineRef: { current: CorrectionTimelineHandle | null };
  onSuccess: ((entries: TimeEntry[]) => void | Promise<void>) | undefined;
};

/**
 * The sentence for a refused save. A session open in another organization
 * names that organization when the server sent its name, which it does only
 * for a member of it.
 */
function describeManualEntryFailure(
  result: Exclude<AddManualEntryResult, { success: true }>,
  targetUserId: string,
  currentUserId: string | null,
): string {
  if (result.error === 'working_in_other_org') {
    const isSelf = targetUserId === currentUserId;
    const place =
      'otherOrgName' in result && typeof result.otherOrgName === 'string'
        ? `in „${result.otherOrgName}“`
        : 'in einer anderen Organisation';
    const title = isSelf
      ? 'Bereits in anderer Organisation eingestempelt'
      : 'Mitarbeiter ist bereits in anderer Organisation eingestempelt';
    const message = isSelf
      ? `Du bist aktuell ${place} eingestempelt. Bitte stemple dort zuerst aus, bevor du hier startest.`
      : `Der ausgewählte Mitarbeiter ist aktuell ${place} eingestempelt. Bitte zuerst dort ausstempeln, bevor hier eine offene Arbeitszeit gestartet wird.`;

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

/** Own time of an earlier day goes in as a correction with its timeline and reason; a refusal stays in the form. */
async function savePastDayTime({
  organizationId,
  dateIso,
  facts,
  reason,
  operationRef,
  setError,
  showBanner,
  onSuccess,
}: {
  organizationId: string;
  dateIso: string;
  facts: (employeeRecordId: string) => TimelineFact[];
  reason: string;
  operationRef: { current: CorrectionOperation | null };
  setError: (error: string | null) => void;
  showBanner: ReturnType<typeof useBanner>['showBanner'];
  onSuccess: ManualEntrySubmitInput['onSuccess'];
}): Promise<void> {
  // The content a retry compares: the day, every activity with its details, and the reason.
  const content = JSON.stringify([dateIso, facts(''), reason]);
  const outcome = await sendUnderOperation(operationRef, content, (operationId) =>
    submitPastDayTime({ organizationId, facts, reason, operationId }),
  );
  if (outcome.kind === 'failed') {
    setError(outcome.message);
    return;
  }
  if (outcome.kind === 'earlier-version-saved') {
    setError(PAST_DAY_EARLIER_VERSION_SAVED);
    return;
  }
  showBanner({ variant: 'success', message: 'Die Korrektur wurde zur Prüfung eingereicht.' });
  await onSuccess?.([]);
}

/** Validates the manual entry form, saves the entries and reports the outcome. */
export function useManualEntrySubmit(input: ManualEntrySubmitInput): {
  handleSubmit: (e: React.FormEvent) => Promise<void>;
  isPending: boolean;
  error: string | null;
  fieldErrors: ManualEntryFieldErrors;
  showTimelineErrors: boolean;
} {
  const { activeOrgId, isAdmin, isAdminOrManager, currentUserId, selectedUserId, canAssignJob } = input;
  const { selectedJobId, onSuccess } = input;
  const { run: runPendingTask, isPending } = usePendingTask();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ManualEntryFieldErrors>(NO_MANUAL_ENTRY_FIELD_ERRORS);
  // An earlier day's timeline shows its rows' errors after the first press of „Speichern“.
  const [attempted, setAttempted] = useState(false);
  const { showBanner } = useBanner();
  // One operation id per form, with the content that may have been saved
  // under it: a retry after a lost response replays the saved correction, and
  // an edit since then must not pass as saved.
  const operationRef = useRef<CorrectionOperation | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors(NO_MANUAL_ENTRY_FIELD_ERRORS);

    if (!activeOrgId) {
      setError('Keine Organisation ausgewählt.');
      return;
    }

    // An untouched or incomplete form sends nothing: it marks the fields instead.
    const plan = planManualEntrySubmission(input);
    if (input.needsReason) setAttempted(true);
    // A timeline still loading sends nothing, and says so at the button.
    if (input.needsReason && !input.timelineRef.current) {
      setError('Die Zeitleiste lädt noch. Bitte speichere gleich noch einmal.');
      return;
    }
    const timelineCheck = input.needsReason ? (input.timelineRef.current?.check() ?? null) : null;
    if (plan.kind === 'invalid' || (timelineCheck && !timelineCheck.valid)) {
      const errors = plan.kind === 'invalid' ? plan.fieldErrors : NO_MANUAL_ENTRY_FIELD_ERRORS;
      setFieldErrors(errors);
      focusFirstInvalidField(
        manualEntryFieldIds(errors, timelineCheck && !timelineCheck.valid ? timelineCheck.fieldErrors : {}),
      );
      return;
    }

    const targetUserId = isAdminOrManager ? selectedUserId : currentUserId;
    if (!targetUserId) {
      setError('Keine Benutzerinformation verfügbar.');
      return;
    }

    void runPendingTask(async () => {
      try {
        if (plan.kind === 'past-day') {
          // An earlier day always carries its checked timeline (needsReason above).
          if (!timelineCheck?.valid) return;
          await savePastDayTime({
            organizationId: activeOrgId,
            dateIso: plan.dateIso,
            facts: timelineCheck.facts,
            reason: plan.reason,
            operationRef,
            setError,
            showBanner,
            onSuccess,
          });
          return;
        }
        await saveManualEntries({
          organizationId: activeOrgId,
          targetUserId,
          currentUserId,
          dateIso: plan.dateIso,
          entries: plan.entries,
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

  return { handleSubmit, isPending, error, fieldErrors, showTimelineErrors: attempted };
}
