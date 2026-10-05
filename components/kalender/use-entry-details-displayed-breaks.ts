'use client';

import { useMemo } from 'react';

import { getAutomaticBreakRange } from '@/lib/time-tracking/settings';
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
    const automaticBreak = getAutomaticBreakRange(blockStart, blockEnd, {
      breakMode: interactiveSession.breakMode ?? 'manual',
      autoBreakThresholdMinutes: interactiveSession.autoBreakThresholdMinutes ?? 360,
      autoBreakDurationMinutes: interactiveSession.autoBreakDurationMinutes ?? 30,
    });

    if (!automaticBreak) {
      return [];
    }

    const breakStartEntry = {
      ...buildDraftEntry(
        'auto-break-start',
        'break_start',
        automaticBreak.breakStart,
        entryUserId,
        entryOrganizationId ?? undefined,
      ),
      isManual: false,
    };
    const breakEndEntry = {
      ...buildDraftEntry(
        'auto-break-end',
        'break_end',
        automaticBreak.breakEnd,
        entryUserId,
        entryOrganizationId ?? undefined,
      ),
      isManual: false,
    };

    return buildEditableBreaks([
      {
        breakStart: breakStartEntry,
        breakEnd: breakEndEntry,
      },
    ]);
  }, [
    clockInDate,
    clockOutDate,
    editedClockIn,
    editedClockOut,
    entryOrganizationId,
    entryUserId,
    interactiveSession.autoBreakDurationMinutes,
    interactiveSession.autoBreakThresholdMinutes,
    interactiveSession.breakMode,
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
