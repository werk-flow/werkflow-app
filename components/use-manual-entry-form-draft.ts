'use client';

import { useEffect } from 'react';

import type { CalendarEntryDraft } from '@/components/kalender/calendar-entry-draft';

export type ManualEntryMode = 'clock_in' | 'clock_out' | 'both';

/** Minutes since midnight for `HH:MM`; an empty part is invalid rather than zero (`Number('')` is 0). */
function clockTimeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':');
  if (!hours || !minutes) return Number.NaN;
  return Number(hours) * 60 + Number(minutes);
}

/** Reports the calendar preview draft of a complete clock-in and clock-out pair, or null. */
export function useManualEntryDraftReport({
  isActive,
  onDraftChange,
  isAdminOrManager,
  selectedUserId,
  currentUserId,
  entryMode,
  selectedDate,
  clockInTime,
  clockOutTime,
}: {
  isActive: boolean;
  onDraftChange: ((draft: CalendarEntryDraft | null) => void) | undefined;
  isAdminOrManager: boolean;
  selectedUserId: string;
  currentUserId: string | null;
  entryMode: ManualEntryMode;
  selectedDate: Date | undefined;
  clockInTime: string;
  clockOutTime: string;
}): void {
  useEffect(() => {
    if (!isActive || !onDraftChange) return;

    const targetUserId = isAdminOrManager ? selectedUserId : currentUserId;
    // An invalid time yields NaN, which the finite check below rejects.
    const durationMinutes = clockTimeToMinutes(clockOutTime) - clockTimeToMinutes(clockInTime);

    if (
      entryMode !== 'both' ||
      !selectedDate ||
      !targetUserId ||
      !Number.isFinite(durationMinutes) ||
      durationMinutes <= 0
    ) {
      onDraftChange(null);
      return;
    }

    onDraftChange({
      date: selectedDate,
      startTime: clockInTime,
      durationMinutes,
      userIds: [targetUserId],
    });
  }, [
    clockInTime,
    clockOutTime,
    currentUserId,
    entryMode,
    isActive,
    isAdminOrManager,
    onDraftChange,
    selectedDate,
    selectedUserId,
  ]);
}
