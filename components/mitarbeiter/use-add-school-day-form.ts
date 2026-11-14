'use client';

import { useState } from 'react';

import { useBanner } from '@/components/ui/banner';
import { useServerAction } from '@/hooks/use-server-action';
import { describeFailure } from '@/lib/action-messages';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import { logError } from '@/lib/logging';
import { addSchoolDay } from '@/lib/personnel/school-day-actions';
import { SCHOOL_DAY_ERROR_MESSAGES } from '@/lib/personnel/school-days';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

export const SCHOOL_DAY_KIND_LABELS = {
  weekday: 'Fester Schultag pro Woche',
  block: 'Blockunterricht',
} as const;
export type SchoolDayFormKind = keyof typeof SCHOOL_DAY_KIND_LABELS;

export type AddSchoolDayForm = ReturnType<typeof useAddSchoolDayForm>;

const SAVE_FAILED = 'Die Berufsschule konnte nicht gespeichert werden.';

/** The add dialog's state: a weekly rule or a block, its dates, and the save with its first-frame pending state. */
export function useAddSchoolDayForm(recordId: string, onClose: (saved: boolean) => void) {
  const { showBanner } = useBanner();
  const [kind, setKind] = useState<SchoolDayFormKind>('weekday');
  const [weekday, setWeekday] = useState<number>(0);
  const [startDate, setStartDate] = useState(getBusinessTodayIso());
  const [endKnown, setEndKnown] = useState(false);
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ start?: string | undefined; end?: string | undefined }>(
    {},
  );
  const { run, isPending } = useServerAction(addSchoolDay);
  const needsEnd = kind === 'block' || endKnown;

  const endError = (): string | undefined => {
    if (!needsEnd) return undefined;
    if (!endDate) return 'Bitte wähle ein Datum aus.';
    return endDate < startDate ? SCHOOL_DAY_ERROR_MESSAGES.invalid_range : undefined;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isPending) return;
    setError(null);
    const nextErrors = { start: startDate ? undefined : 'Bitte wähle ein Datum aus.', end: endError() };
    setFieldErrors(nextErrors);
    if (focusFirstInvalidField({ 'school-day-start': nextErrors.start, 'school-day-end': nextErrors.end }))
      return;
    try {
      const result = await run({
        employeeRecordId: recordId,
        kind,
        weekday: kind === 'weekday' ? weekday : null,
        startDate,
        endDate: needsEnd ? endDate : null,
      });
      if (!result.success) {
        setError(describeFailure(result.error, SCHOOL_DAY_ERROR_MESSAGES, SAVE_FAILED));
        return;
      }
      showBanner({ variant: 'success', message: 'Die Berufsschule wurde eingetragen.' });
      onClose(true);
    } catch (submitError) {
      logError('useAddSchoolDayForm: save failed', submitError);
      setError(SAVE_FAILED);
    }
  };

  return {
    kind,
    setKind,
    weekday,
    setWeekday,
    startDate,
    setStartDate,
    endKnown,
    setEndKnown,
    endDate,
    setEndDate,
    needsEnd,
    error,
    fieldErrors,
    isPending,
    handleSubmit,
  };
}
