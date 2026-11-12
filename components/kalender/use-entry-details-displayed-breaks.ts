'use client';

import { useMemo } from 'react';

import { getAutomaticBreakRanges, type AutomaticBreakRange } from '@/lib/time-tracking/settings';
import {
  buildDraftEntry,
  buildEditableBreaks,
  getBreakDurationMinutes,
  type EditableBreak,
} from './entry-details-timeline';
import type { EntryDetailsDraft } from './use-entry-details-draft';
import type { EntryDetailsSnapshot } from './use-entry-details-session';

export type EntryDetailsDisplayedBreaks = {
  displayedBreaks: EditableBreak[];
  totalBreakMinutes: number;
  totalWorkMinutes: number | null;
};

/** The automatic breaks as breaks the dialog can show. */
function automaticEditableBreaks(
  automaticBreaks: AutomaticBreakRange[],
  entryUserId: string | undefined,
  entryOrganizationId: string | null,
): EditableBreak[] {
  const automaticEntry = (id: string, entryType: 'break_start' | 'break_end', at: Date) => ({
    ...buildDraftEntry(id, entryType, at, entryUserId, entryOrganizationId ?? undefined),
    isManual: false,
  });
  return buildEditableBreaks(
    automaticBreaks.map((automaticBreak, index) => {
      const suffix = index === 0 ? '' : `-${index + 1}`;
      return {
        breakStart: automaticEntry(`auto-break${suffix}-start`, 'break_start', automaticBreak.breakStart),
        breakEnd: automaticEntry(`auto-break${suffix}-end`, 'break_end', automaticBreak.breakEnd),
      };
    }),
  );
}

/**
 * The breaks the dialog shows (the draft, or the one derived from the
 * organization's automatic break rule) and the block totals that follow.
 */
export function useEntryDetailsDisplayedBreaks(
  snapshot: EntryDetailsSnapshot,
  draft: EntryDetailsDraft,
): EntryDetailsDisplayedBreaks {
  const {
    interactiveSession,
    isAutomaticBreakMode,
    clockInDate,
    clockOutDate,
    entryUserId,
    entryOrganizationId,
  } = snapshot;
  const { editedClockIn, editedClockOut, editedBreaks } = draft;

  const automaticDisplayBreaks = useMemo(() => {
    if (!isAutomaticBreakMode) {
      return [];
    }

    const blockStart = editedClockIn ?? clockInDate;
    const blockEnd = editedClockOut ?? clockOutDate ?? (blockStart ? new Date() : null);
    const automaticBreaks = getAutomaticBreakRanges(blockStart, blockEnd, interactiveSession.breakPolicy);
    return automaticEditableBreaks(automaticBreaks, entryUserId, entryOrganizationId);
  }, [
    clockInDate,
    clockOutDate,
    editedClockIn,
    editedClockOut,
    entryOrganizationId,
    entryUserId,
    interactiveSession.breakPolicy,
    isAutomaticBreakMode,
  ]);
  const displayedBreaks = isAutomaticBreakMode ? automaticDisplayBreaks : editedBreaks;
  const totalBreakMinutes = useMemo(
    () => displayedBreaks.reduce((total, workBreak) => total + getBreakDurationMinutes(workBreak), 0),
    [displayedBreaks],
  );
  const totalWorkMinutes = useMemo(() => {
    const blockStart = editedClockIn ?? clockInDate;
    const blockEnd = editedClockOut ?? clockOutDate ?? (blockStart ? new Date() : null);

    if (!blockStart || !blockEnd) {
      return null;
    }

    const totalMinutes = Math.max(0, (blockEnd.getTime() - blockStart.getTime()) / 60000);
    return Math.max(0, totalMinutes - totalBreakMinutes);
  }, [editedClockIn, editedClockOut, clockInDate, clockOutDate, totalBreakMinutes]);

  return { displayedBreaks, totalBreakMinutes, totalWorkMinutes };
}
