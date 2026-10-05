'use client';

import { useState } from 'react';

import { usePendingTask } from '@/hooks/use-server-action';
import { useBanner } from '@/components/ui/banner';
import { describeFailure, SHARED_FAILURE_MESSAGES } from '@/lib/action-messages';
import { addManualEntry, getTimeEntries } from '@/lib/time-tracking/actions';
import { validateManualEntries } from '@/lib/time-tracking/validation';
import type { ManualEntryInput, TimeEntry } from '@/lib/time-tracking/types';
import { toLocalDateString } from '@/lib/utils';
import type { ManualEntryMode } from '@/components/use-manual-entry-form-draft';

const MANUAL_ENTRY_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  target_not_a_member: 'Der ausgewählte Mitarbeiter ist kein Mitglied dieser Organisation.',
  validation_failed: 'Die Validierung ist fehlgeschlagen.',
  insert_failed: 'Der Eintrag konnte nicht gespeichert werden.',
};

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
  onSuccess,
}: {
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
  onSuccess: ((entries: TimeEntry[]) => void | Promise<void>) | undefined;
}): {
  handleSubmit: (e: React.FormEvent) => Promise<void>;
  isPending: boolean;
  error: string | null;
  fieldErrors: { member?: string; date?: string };
} {
  const { run: runPendingTask, isPending } = usePendingTask();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ member?: string; date?: string }>({});
  const { showBanner } = useBanner();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    if (!activeOrgId) {
      setError('Keine Organisation ausgewählt.');
      return;
    }

    if (isAdminOrManager && !selectedUserId) {
      setFieldErrors({ member: 'Bitte wähle einen Mitarbeiter aus.' });
      document.getElementById('manual-entry-member')?.focus();
      return;
    }

    const targetUserId = isAdminOrManager ? selectedUserId : currentUserId;
    if (!targetUserId) {
      setError('Keine Benutzerinformation verfügbar.');
      return;
    }

    if (!selectedDate) {
      setFieldErrors({ date: 'Bitte ein gültiges Datum wählen.' });
      document.getElementById('manual-entry-date')?.focus();
      return;
    }

    const dateIso = toLocalDateString(selectedDate);
    const entries: ManualEntryInput[] = [];

    if (entryMode === 'clock_in' || entryMode === 'both') {
      const clockInTimestamp = new Date(`${dateIso}T${clockInTime}:00`).toISOString();
      entries.push({ entryType: 'clock_in', timestamp: clockInTimestamp });
    }

    if (entryMode === 'clock_out' || entryMode === 'both') {
      const clockOutTimestamp = new Date(`${dateIso}T${clockOutTime}:00`).toISOString();
      entries.push({ entryType: 'clock_out', timestamp: clockOutTimestamp });
    }

    void runPendingTask(async () => {
      try {
        const dayStart = new Date(dateIso);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(dateIso);
        dayEnd.setHours(23, 59, 59, 999);

        const existingResult = await getTimeEntries({
          organizationId: activeOrgId,
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
          setError(validationResult.error || 'Validierung fehlgeschlagen.');
          return;
        }

        const result = await addManualEntry({
          organizationId: activeOrgId,
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
            setError(`${title}: ${message}`);
          } else {
            setError(
              describeFailure(
                result.error,
                MANUAL_ENTRY_ERROR_MESSAGES,
                'Der Eintrag konnte nicht gespeichert werden.',
              ),
            );
          }
        }
      } catch {
        setError(SHARED_FAILURE_MESSAGES.unexpected_error);
      }
    });
  };

  return { handleSubmit, isPending, error, fieldErrors };
}
