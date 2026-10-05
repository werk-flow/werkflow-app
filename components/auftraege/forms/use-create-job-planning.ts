'use client';

import { useEffect, useMemo, useState } from 'react';

import type { CalendarEntryDraft } from '@/components/kalender/calendar-entry-draft';
import {
  calculatePlannedWorkingMinutes,
  formatMinutesAsHoursInput,
  parseHoursInputToMinutes,
} from '@/lib/jobs/planned-working';

type CreateJobPlanningOptions = {
  defaultDate: Date | undefined;
  defaultTime: string | undefined;
  defaultDurationHours: string | undefined;
  defaultEmployeeIds: string[] | undefined;
  isActive: boolean;
  onDraftChange: ((draft: CalendarEntryDraft | null) => void) | undefined;
};

/** Date, time, duration, assignees and the planned working effort derived from them. */
export function useCreateJobPlanning({
  defaultDate,
  defaultTime,
  defaultDurationHours,
  defaultEmployeeIds,
  isActive,
  onDraftChange,
}: CreateJobPlanningOptions) {
  const [plannedDate, setPlannedDate] = useState<Date | undefined>(defaultDate);
  const [plannedTime, setPlannedTime] = useState(defaultTime ?? '');
  const [estimatedHours, setEstimatedHours] = useState(defaultDurationHours ?? '');
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>(defaultEmployeeIds ?? []);
  const [editedPlannedWorkingHours, setPlannedWorkingHours] = useState('');
  const [plannedWorkingTouched, setPlannedWorkingTouched] = useState(false);

  const suggestedPlannedWorkingMinutes = useMemo(
    () => calculatePlannedWorkingMinutes(parseHoursInputToMinutes(estimatedHours), selectedEmployees.length),
    [estimatedHours, selectedEmployees.length],
  );

  // The effort field follows the suggestion until the user edits it.
  const plannedWorkingHours = plannedWorkingTouched
    ? editedPlannedWorkingHours
    : formatMinutesAsHoursInput(suggestedPlannedWorkingMinutes);

  useEffect(() => {
    if (!isActive || !onDraftChange) return;

    const durationMinutes = parseHoursInputToMinutes(estimatedHours);
    if (!plannedDate || !plannedTime || !durationMinutes || selectedEmployees.length === 0) {
      onDraftChange(null);
      return;
    }

    onDraftChange({
      date: plannedDate,
      startTime: plannedTime,
      durationMinutes,
      userIds: selectedEmployees,
    });
  }, [estimatedHours, isActive, onDraftChange, plannedDate, plannedTime, selectedEmployees]);

  return {
    plannedDate,
    setPlannedDate,
    plannedTime,
    setPlannedTime,
    estimatedHours,
    setEstimatedHours,
    selectedEmployees,
    setSelectedEmployees,
    plannedWorkingHours,
    setPlannedWorkingHours,
    plannedWorkingTouched,
    setPlannedWorkingTouched,
    suggestedPlannedWorkingMinutes,
  };
}
