'use client';

import { useCallback, useState } from 'react';

import { useBanner } from '@/components/ui/banner';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';
import { describeFailure } from '@/lib/action-messages';
import { readInBackground } from '@/lib/data/background-read-client';
import { logError } from '@/lib/logging';
import { cancelSchoolDay } from '@/lib/personnel/school-day-actions';
import { SCHOOL_DAY_ERROR_MESSAGES, type SchoolDay } from '@/lib/personnel/school-days';

type DialogState = { mode: 'closed' } | { mode: 'add' } | { mode: 'end'; schoolDay: SchoolDay };

/**
 * The school rules of one apprentice, live, with the section's dialogs and
 * the cancellation: the row shows its pending state while the server works,
 * a success banner confirms, a refusal says why.
 */
export function useSchoolDays(recordId: string) {
  const [dialogState, setDialogState] = useState<DialogState>({ mode: 'closed' });
  const [cancelTarget, setCancelTarget] = useState<SchoolDay | null>(null);
  const { showBanner } = useBanner();
  const busy = useBusyIds();

  const view = useLiveView<SchoolDay[]>({
    tables: ['school_days'],
    read: async ({ signal }): Promise<LiveViewResult<SchoolDay[]>> => {
      const result = await readInBackground('school-days-for-record', { employeeRecordId: recordId }, signal);
      return result.success ? { ok: true, data: result.schoolDays } : { ok: false };
    },
    resetKey: recordId,
  });
  const { refresh } = view;

  const closeDialog = useCallback(
    (saved: boolean) => {
      setDialogState({ mode: 'closed' });
      if (saved) void refresh();
    },
    [refresh],
  );

  const [cancelError, setCancelError] = useState<string | null>(null);
  const confirmCancel = (schoolDay: SchoolDay | null) => {
    setCancelError(null);
    setCancelTarget(schoolDay);
  };

  // The confirmation stays open and pending until the answer lands; a refusal
  // stays in it with its sentence, so the office can retry or cancel.
  const cancel = async (schoolDay: SchoolDay) => {
    setCancelError(null);
    try {
      const result = await busy.run(schoolDay.id, () => cancelSchoolDay(schoolDay.id));
      if (!result.success) {
        setCancelError(
          describeFailure(result.error, SCHOOL_DAY_ERROR_MESSAGES, 'Die Stornierung ist fehlgeschlagen.'),
        );
        return;
      }
      setCancelTarget(null);
      showBanner({ variant: 'success', message: 'Die Berufsschule wurde storniert.' });
      await refresh();
    } catch (error) {
      logError('useSchoolDays: cancel failed', error);
      setCancelError('Die Stornierung ist fehlgeschlagen.');
    }
  };

  return {
    view,
    busy,
    dialogState,
    setDialogState,
    closeDialog,
    cancelTarget,
    confirmCancel,
    cancelError,
    cancel,
  };
}
