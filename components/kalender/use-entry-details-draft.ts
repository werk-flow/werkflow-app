'use client';

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

import {
  applyDatePart,
  buildEditableBreaks,
  buildNewEditableBreak,
  type EditableBreak,
} from './entry-details-timeline';
import type { EntryDetailsSnapshot } from './use-entry-details-session';

/** The edit draft of the entry details dialog and the handlers that change it. */
export type EntryDetailsDraft = {
  isEditing: boolean;
  setIsEditing: Dispatch<SetStateAction<boolean>>;
  error: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
  editedClockIn: Date | null;
  setEditedClockIn: Dispatch<SetStateAction<Date | null>>;
  editedClockOut: Date | null;
  setEditedClockOut: Dispatch<SetStateAction<Date | null>>;
  editedBreaks: EditableBreak[];
  removedBreaks: EditableBreak[];
  editedBlockDate: Date | null;
  handleStartEdit: () => void;
  handleCancelEdit: () => void;
  handleAddBreak: () => void;
  handleStartEditWithBreak: () => void;
  handleRemoveBreak: (key: string) => void;
  handleBreakChange: (key: string, field: 'breakStart' | 'breakEnd', value: Date) => void;
  handleBlockDateChange: (nextDate: Date | undefined) => void;
};

type DraftBreakEdits = {
  editedBreaks: EditableBreak[];
  setEditedBreaks: Dispatch<SetStateAction<EditableBreak[]>>;
  setRemovedBreaks: Dispatch<SetStateAction<EditableBreak[]>>;
  setEditedBlockDate: Dispatch<SetStateAction<Date | null>>;
  setEditedClockIn: Dispatch<SetStateAction<Date | null>>;
  setEditedClockOut: Dispatch<SetStateAction<Date | null>>;
};

/** The edits of one break and of the block's date, which moves every time of the block with it. */
function draftBreakHandlers({
  editedBreaks,
  setEditedBreaks,
  setRemovedBreaks,
  setEditedBlockDate,
  setEditedClockIn,
  setEditedClockOut,
}: DraftBreakEdits): Pick<
  EntryDetailsDraft,
  'handleRemoveBreak' | 'handleBreakChange' | 'handleBlockDateChange'
> {
  const handleRemoveBreak = (key: string) => {
    const targetBreak = editedBreaks.find((workBreak) => workBreak.key === key);
    if (targetBreak && !targetBreak.isNew) {
      setRemovedBreaks((current) =>
        current.some((workBreak) => workBreak.key === key) ? current : [...current, targetBreak],
      );
    }
    setEditedBreaks((prev) => prev.filter((workBreak) => workBreak.key !== key));
  };

  const handleBreakChange = (key: string, field: 'breakStart' | 'breakEnd', value: Date) => {
    setEditedBreaks((prev) =>
      prev.map((workBreak) =>
        workBreak.key === key
          ? {
              ...workBreak,
              [field]: value,
            }
          : workBreak,
      ),
    );
  };

  const handleBlockDateChange = (nextDate: Date | undefined) => {
    if (!nextDate) return;

    setEditedBlockDate(new Date(nextDate));
    setEditedClockIn((prev) => (prev ? applyDatePart(prev, nextDate) : prev));
    setEditedClockOut((prev) => (prev ? applyDatePart(prev, nextDate) : prev));
    setEditedBreaks((prev) =>
      prev.map((workBreak) => ({
        ...workBreak,
        breakStart: applyDatePart(workBreak.breakStart, nextDate),
        breakEnd: workBreak.breakEnd ? applyDatePart(workBreak.breakEnd, nextDate) : null,
      })),
    );
  };

  return { handleRemoveBreak, handleBreakChange, handleBlockDateChange };
}

type EntryDetailsDraftOptions = {
  open: boolean;
  startInEditMode: boolean;
  snapshot: EntryDetailsSnapshot;
};

export function useEntryDetailsDraft({
  open,
  startInEditMode,
  snapshot,
}: EntryDetailsDraftOptions): EntryDetailsDraft {
  const { isAutomaticBreakMode, sessionBreaks, clockInTimestamp, clockOutTimestamp } = snapshot;
  const { clockInDate, clockOutDate, hasCanonicalSegment, blockReferenceDate } = snapshot;
  const [error, setError] = useState<string | null>(null);
  const [editedClockIn, setEditedClockIn] = useState<Date | null>(null);
  const [editedClockOut, setEditedClockOut] = useState<Date | null>(null);
  const [editedBreaks, setEditedBreaks] = useState<EditableBreak[]>([]);
  const [removedBreaks, setRemovedBreaks] = useState<EditableBreak[]>([]);
  const [editedBlockDate, setEditedBlockDate] = useState<Date | null>(null);
  const [isEditing, setIsEditing] = useState(startInEditMode && !hasCanonicalSegment);

  useEffect(() => {
    if (!open) return;

    // Keyed on open only: Realtime-driven session refetches replace the
    // snapshot props with equal content mid-dialog, and re-running this reset
    // then wipes (and remounts) the edit draft under the user's typing — the
    // refresh-interrupted-dialog defect class. handleStartEdit re-seeds the
    // draft from the current snapshot when editing begins, so the snapshot
    // values are deliberately read without being dependencies here.

    setIsEditing(startInEditMode && !hasCanonicalSegment);
    setError(null);
    setEditedClockIn(clockInTimestamp ? new Date(clockInTimestamp) : null);
    setEditedClockOut(clockOutTimestamp ? new Date(clockOutTimestamp) : null);
    setEditedBreaks(isAutomaticBreakMode ? [] : buildEditableBreaks(sessionBreaks));
    setRemovedBreaks([]);
    setEditedBlockDate(blockReferenceDate ? new Date(blockReferenceDate) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see the keyed-on-open note above
  }, [open]);

  const handleStartEdit = () => {
    setIsEditing(true);
    setEditedClockIn(clockInDate ? new Date(clockInDate) : null);
    setEditedClockOut(clockOutDate ? new Date(clockOutDate) : null);
    setEditedBreaks(buildEditableBreaks(sessionBreaks));
    setRemovedBreaks([]);
    setEditedBlockDate(blockReferenceDate ? new Date(blockReferenceDate) : null);
    setError(null);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditedClockIn(clockInDate ? new Date(clockInDate) : null);
    setEditedClockOut(clockOutDate ? new Date(clockOutDate) : null);
    setEditedBreaks(buildEditableBreaks(sessionBreaks));
    setRemovedBreaks([]);
    setEditedBlockDate(blockReferenceDate ? new Date(blockReferenceDate) : null);
    setError(null);
  };

  const handleAddBreak = () => {
    if (!editedClockIn || !editedClockOut) return;

    setEditedBreaks([buildNewEditableBreak(editedClockIn, editedClockOut)]);
  };

  const handleStartEditWithBreak = () => {
    handleStartEdit();

    const baseClockIn = clockInDate ? new Date(clockInDate) : null;
    const baseClockOut = clockOutDate ? new Date(clockOutDate) : null;
    if (!baseClockIn || !baseClockOut) return;

    setEditedBreaks([buildNewEditableBreak(baseClockIn, baseClockOut)]);
  };

  return {
    isEditing,
    setIsEditing,
    error,
    setError,
    editedClockIn,
    setEditedClockIn,
    editedClockOut,
    setEditedClockOut,
    editedBreaks,
    removedBreaks,
    editedBlockDate,
    handleStartEdit,
    handleCancelEdit,
    handleAddBreak,
    handleStartEditWithBreak,
    ...draftBreakHandlers({
      editedBreaks,
      setEditedBreaks,
      setRemovedBreaks,
      setEditedBlockDate,
      setEditedClockIn,
      setEditedClockOut,
    }),
  };
}
