// Pure timeline helpers of the calendar entry details dialog: break
// derivation, the editable break draft, default break placement and the
// validation of an edited work block.

import type { TimeEntry, WorkSessionBreak } from '@/lib/time-tracking/types';

export type EditableBreak = {
  key: string;
  breakStartEntry: TimeEntry | null;
  breakEndEntry: TimeEntry | null;
  breakStart: Date;
  breakEnd: Date | null;
  isNew?: boolean;
};

export function sortTimeEntries(entries: TimeEntry[]): TimeEntry[] {
  return [...entries].sort((a, b) => {
    const diff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    if (diff !== 0) return diff;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

export function deriveBreaksFromEntries(entries: TimeEntry[]): WorkSessionBreak[] {
  const breaks: WorkSessionBreak[] = [];
  let currentBreakStart: TimeEntry | null = null;

  for (const entry of sortTimeEntries(entries)) {
    if (entry.entryType === 'break_start') {
      currentBreakStart = entry;
      continue;
    }

    if (currentBreakStart && (entry.entryType === 'break_end' || entry.entryType === 'clock_out')) {
      breaks.push({
        breakStart: currentBreakStart,
        breakEnd: entry.entryType === 'break_end' ? entry : null,
      });
      currentBreakStart = null;
    }
  }

  if (currentBreakStart) {
    breaks.push({
      breakStart: currentBreakStart,
      breakEnd: null,
    });
  }

  return breaks;
}

export function buildEditableBreaks(breaks: WorkSessionBreak[]): EditableBreak[] {
  return breaks.map((workBreak, index) => ({
    key: `${workBreak.breakStart.id}:${workBreak.breakEnd?.id ?? index}`,
    breakStartEntry: workBreak.breakStart,
    breakEndEntry: workBreak.breakEnd,
    breakStart: new Date(workBreak.breakStart.timestamp),
    breakEnd: workBreak.breakEnd ? new Date(workBreak.breakEnd.timestamp) : null,
  }));
}

export function getBreakDurationMinutes(workBreak: { breakStart: Date; breakEnd: Date | null }): number {
  const breakEnd = workBreak.breakEnd ?? new Date();
  return Math.max(0, (breakEnd.getTime() - workBreak.breakStart.getTime()) / 60000);
}

export function applyDatePart(base: Date, dateSource: Date): Date {
  const updated = new Date(base);
  updated.setFullYear(dateSource.getFullYear(), dateSource.getMonth(), dateSource.getDate());
  return updated;
}

function buildDefaultBreakRange(start: Date, end: Date) {
  const totalMinutes = Math.max(1, (end.getTime() - start.getTime()) / 60000);
  const desiredBreakMinutes = Math.min(30, Math.max(5, Math.floor(totalMinutes / 3)));
  const centerMs = start.getTime() + (end.getTime() - start.getTime()) / 2;
  const breakStart = new Date(centerMs - desiredBreakMinutes * 30000);
  const breakEnd = new Date(breakStart.getTime() + desiredBreakMinutes * 60000);

  if (breakStart <= start) {
    breakStart.setTime(start.getTime() + 5 * 60000);
    breakEnd.setTime(Math.min(end.getTime() - 5 * 60000, breakStart.getTime() + desiredBreakMinutes * 60000));
  }

  if (breakEnd >= end) {
    breakEnd.setTime(end.getTime() - 5 * 60000);
    breakStart.setTime(
      Math.max(start.getTime() + 5 * 60000, breakEnd.getTime() - desiredBreakMinutes * 60000),
    );
  }

  return { breakStart, breakEnd };
}

/** The single new break a block without breaks gets, centered in the block. */
export function buildNewEditableBreak(start: Date, end: Date): EditableBreak {
  const { breakStart, breakEnd } = buildDefaultBreakRange(start, end);

  return {
    key: `new-break-${Date.now()}`,
    breakStartEntry: null,
    breakEndEntry: null,
    breakStart,
    breakEnd,
    isNew: true,
  };
}

export function buildDraftEntry(
  key: string,
  entryType: TimeEntry['entryType'],
  timestamp: Date,
  userId?: string,
  organizationId?: string | null,
): TimeEntry {
  const isoTimestamp = timestamp.toISOString();

  return {
    id: key,
    userId: userId ?? '',
    organizationId: organizationId ?? '',
    entryType,
    timestamp: isoTimestamp,
    isManual: true,
    jobId: null,
    status: 'approved',
    reviewedBy: null,
    reviewedAt: null,
    createdAt: isoTimestamp,
    updatedAt: isoTimestamp,
  };
}

type EntryTimelineDraft = {
  editedClockIn: Date | null;
  editedClockOut: Date | null;
  displayedBreaks: EditableBreak[];
  clockInDate: Date | null;
  clockOutDate: Date | null;
};

/** Returns the German message of the first violated rule, or null when valid. */
export function validateEntryDetailsTimeline({
  editedClockIn,
  editedClockOut,
  displayedBreaks,
  clockInDate,
  clockOutDate,
}: EntryTimelineDraft): string | null {
  const referenceDay =
    editedClockIn ?? editedClockOut ?? displayedBreaks[0]?.breakStart ?? clockInDate ?? clockOutDate;

  const now = Date.now();

  if (editedClockIn && editedClockIn.getTime() > now) {
    return 'Arbeitsbeginn kann nicht in der Zukunft liegen.';
  }

  if (editedClockOut && editedClockOut.getTime() > now) {
    return 'Arbeitsende kann nicht in der Zukunft liegen.';
  }

  if (editedClockIn && editedClockOut && editedClockOut <= editedClockIn) {
    return 'Das Arbeitsende muss nach dem Arbeitsbeginn liegen.';
  }

  if (!referenceDay) {
    return null;
  }

  const sameLocalDay = (value: Date) =>
    value.getFullYear() === referenceDay.getFullYear() &&
    value.getMonth() === referenceDay.getMonth() &&
    value.getDate() === referenceDay.getDate();

  const sortedBreaks = [...displayedBreaks].sort((a, b) => a.breakStart.getTime() - b.breakStart.getTime());

  let previousBreakEnd: Date | null = null;

  for (const [index, workBreak] of sortedBreaks.entries()) {
    if (workBreak.breakStart.getTime() > now) {
      return 'Pausenbeginn kann nicht in der Zukunft liegen.';
    }

    if (!sameLocalDay(workBreak.breakStart)) {
      return 'Pausenzeiten müssen innerhalb desselben Tages liegen.';
    }

    if (!workBreak.breakEnd) {
      return 'Bitte gib für die Pause auch ein Pausenende an.';
    }

    if (workBreak.breakEnd.getTime() > now) {
      return 'Pausenende kann nicht in der Zukunft liegen.';
    }

    if (!sameLocalDay(workBreak.breakEnd)) {
      return 'Pausenzeiten müssen innerhalb desselben Tages liegen.';
    }

    if (editedClockIn && workBreak.breakStart <= editedClockIn) {
      return 'Der Pausenbeginn muss nach dem Arbeitsbeginn liegen.';
    }

    if (workBreak.breakEnd <= workBreak.breakStart) {
      return 'Das Pausenende muss nach dem Pausenbeginn liegen.';
    }

    if (editedClockOut && workBreak.breakEnd >= editedClockOut) {
      return 'Die Pause muss vor dem Arbeitsende abgeschlossen sein.';
    }

    if (previousBreakEnd && workBreak.breakStart <= previousBreakEnd) {
      return `Pausen dürfen sich nicht überschneiden (Pause ${index + 1}).`;
    }

    previousBreakEnd = workBreak.breakEnd;
  }

  return null;
}
