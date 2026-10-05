'use client';

import { useState } from 'react';

import { useBanner } from '@/components/ui/banner';
import { addWorkSchedule, updateWorkSchedule } from '@/lib/personnel/actions';
import type { WorkSchedule } from '@/lib/personnel/schedule';
import { getBusinessTodayIso } from '@/lib/personnel/types';
import { SCHEDULE_ERROR_MESSAGES, getScheduleErrorMessage } from './work-schedule-format';

// Default for a new schedule: the common full-time week; the office adjusts.
const DEFAULT_DAY_HOURS = ['8', '8', '8', '8', '8', '0', '0'];

type WorkScheduleFormInput = {
  recordId: string;
  schedule: WorkSchedule | null;
  onClose: (saved: boolean) => void;
};

/** Field state, validation and save of the weekly schedule dialog. */
export function useWorkScheduleForm({ recordId, schedule, onClose }: WorkScheduleFormInput) {
  const [validFrom, setValidFrom] = useState<string>(schedule?.validFrom ?? getBusinessTodayIso());
  const [dayHours, setDayHours] = useState<string[]>(
    schedule
      ? schedule.dayMinutes.map((minutes) =>
          (minutes / 60).toLocaleString('de-DE', { maximumFractionDigits: 2 }),
        )
      : DEFAULT_DAY_HOURS,
  );
  const [note, setNote] = useState<string>(schedule?.note ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validFromError, setValidFromError] = useState<string | null>(null);
  const { showBanner } = useBanner();

  const parsedDayMinutes: (number | null)[] = dayHours.map((value) => {
    const trimmed = value.trim().replace(',', '.');
    if (trimmed.length === 0) return 0;
    const parsed = Number(trimmed);
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 24) return null;
    return Math.round(parsed * 60);
  });

  const weeklyMinutes = parsedDayMinutes.every((m) => m !== null)
    ? (parsedDayMinutes as number[]).reduce((total, m) => total + m, 0)
    : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setError(null);

    if (!validFrom) {
      setValidFromError(SCHEDULE_ERROR_MESSAGES.invalid_valid_from);
      document.getElementById('schedule-valid-from')?.focus();
      return;
    }
    const firstInvalidDay = parsedDayMinutes.findIndex((m) => m === null);
    if (firstInvalidDay !== -1) {
      setError(SCHEDULE_ERROR_MESSAGES.invalid_day_minutes);
      document.getElementById(`schedule-day-${firstInvalidDay}`)?.focus();
      return;
    }

    setIsSaving(true);
    const input = {
      validFrom,
      dayMinutes: parsedDayMinutes as number[],
      note: note.trim().length > 0 ? note.trim() : null,
    };
    // A rejected Server Action shows the fallback instead of a stuck spinner.
    const result = await (
      schedule ? updateWorkSchedule(schedule.id, input) : addWorkSchedule(recordId, input)
    )
      .catch(() => ({ success: false as const, error: undefined }))
      .finally(() => setIsSaving(false));

    if (result.success) {
      showBanner({
        variant: 'success',
        message: 'Der Wochenplan wurde gespeichert.',
      });
      onClose(true);
    } else {
      setError(
        getScheduleErrorMessage(result.error ?? '', 'Der Wochenplan konnte nicht gespeichert werden.'),
      );
    }
  };

  return {
    validFrom,
    setValidFrom,
    dayHours,
    setDayHours,
    note,
    setNote,
    isSaving,
    error,
    validFromError,
    setValidFromError,
    weeklyMinutes,
    handleSubmit,
  };
}
