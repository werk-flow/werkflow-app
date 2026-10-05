'use client';

import { useState } from 'react';

import { useBanner } from '@/components/ui/banner';
import { describeFailure } from '@/lib/action-messages';
import { addEmploymentCondition, updateEmploymentCondition } from '@/lib/personnel/actions';
import type { EmploymentCondition, EmploymentType } from '@/lib/personnel/types';
import { getBusinessTodayIso } from '@/lib/personnel/types';
import { formatDecimalDe, parseBoundedDecimalInput } from '@/lib/ui/decimal';
import { CONDITION_ERROR_MESSAGES } from './employment-condition-format';

type EmploymentConditionFormInput = {
  recordId: string;
  condition: EmploymentCondition | null;
  onClose: (saved: boolean) => void;
};

/** Field state, validation and save of the employment condition dialog. */
export function useEmploymentConditionForm({ recordId, condition, onClose }: EmploymentConditionFormInput) {
  const [validFrom, setValidFrom] = useState<string>(condition?.validFrom ?? getBusinessTodayIso());
  const [employmentType, setEmploymentType] = useState<EmploymentType>(
    condition?.employmentType ?? 'vollzeit',
  );
  const [weeklyHours, setWeeklyHours] = useState<string>(
    condition?.weeklyHours !== null && condition?.weeklyHours !== undefined
      ? formatDecimalDe(condition.weeklyHours)
      : '',
  );
  const [vacationDays, setVacationDays] = useState<string>(
    condition?.vacationDaysPerYear !== null && condition?.vacationDaysPerYear !== undefined
      ? formatDecimalDe(condition.vacationDaysPerYear, 1)
      : '',
  );
  const [note, setNote] = useState<string>(condition?.note ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    validFrom?: string | undefined;
    weeklyHours?: string | undefined;
    vacationDays?: string | undefined;
  }>({});
  const { showBanner } = useBanner();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setError(null);

    // The columns hold two (hours) and one (days) fractional digits.
    const parsedWeeklyHours = parseBoundedDecimalInput(weeklyHours, 2);
    const parsedVacationDays = parseBoundedDecimalInput(vacationDays, 1);
    const nextFieldErrors = {
      validFrom: validFrom ? undefined : CONDITION_ERROR_MESSAGES.invalid_valid_from,
      weeklyHours:
        parsedWeeklyHours === undefined
          ? 'Bitte gib die Wochenstunden als Zahl mit höchstens zwei Nachkommastellen an.'
          : undefined,
      vacationDays:
        parsedVacationDays === undefined
          ? 'Bitte gib die Urlaubstage als Zahl mit höchstens einer Nachkommastelle an.'
          : undefined,
    };
    setFieldErrors(nextFieldErrors);
    const firstInvalidId = nextFieldErrors.validFrom
      ? 'condition-valid-from'
      : nextFieldErrors.weeklyHours
        ? 'condition-weekly-hours'
        : nextFieldErrors.vacationDays
          ? 'condition-vacation-days'
          : null;
    if (firstInvalidId) {
      document.getElementById(firstInvalidId)?.focus();
      return;
    }

    setIsSaving(true);
    const input = {
      validFrom,
      employmentType,
      weeklyHours: parsedWeeklyHours ?? null,
      vacationDaysPerYear: parsedVacationDays ?? null,
      note: note.trim().length > 0 ? note.trim() : null,
    };
    // A rejected Server Action shows the fallback instead of a stuck spinner.
    const result = await (
      condition ? updateEmploymentCondition(condition.id, input) : addEmploymentCondition(recordId, input)
    )
      .catch(() => ({ success: false as const, error: undefined }))
      .finally(() => setIsSaving(false));

    if (result.success) {
      showBanner({
        variant: 'success',
        message: 'Die Kondition wurde gespeichert.',
      });
      onClose(true);
    } else {
      setError(
        describeFailure(
          result.error ?? '',
          CONDITION_ERROR_MESSAGES,
          'Die Kondition konnte nicht gespeichert werden.',
        ),
      );
    }
  };

  return {
    validFrom,
    setValidFrom,
    employmentType,
    setEmploymentType,
    weeklyHours,
    setWeeklyHours,
    vacationDays,
    setVacationDays,
    note,
    setNote,
    isSaving,
    error,
    fieldErrors,
    handleSubmit,
  };
}
