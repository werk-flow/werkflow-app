// Saving the edit draft of the calendar entry details dialog: timestamp
// updates, new breaks and removed breaks are applied one Server Action at a
// time, and every applied step is rolled back when a later one is refused.

import { addManualEntry, deleteEntry, updateEntry } from '@/lib/time-tracking/actions';
import type { TimeEntry, WorkSession } from '@/lib/time-tracking/types';
import { closeEntryDetailsWithRequest, type EntryDetailsCommandContext } from './entry-details-commands';
import { formatActionError } from './entry-details-labels';
import { validateEntryDetailsTimeline, type EditableBreak } from './entry-details-timeline';
import type { EntryDetailsDraft } from './use-entry-details-draft';
import type { EntryDetailsSnapshot } from './use-entry-details-session';

type EntryTimestampUpdate = {
  entryId: string;
  originalTimestamp: string;
  nextTimestamp: string;
};

/** What one save has applied so far, so a refusal can undo it. */
type EntrySaveProgress = {
  requestCreated: boolean;
  appliedUpdates: Array<{
    entryId: string;
    originalTimestamp: string;
    originalEntryType?: TimeEntry['entryType'];
    originalJobId?: string | null;
  }>;
  createdEntries: TimeEntry[];
};

type SetEntryDetailsError = EntryDetailsCommandContext['setError'];

async function rollbackEntrySave(progress: EntrySaveProgress): Promise<void> {
  for (const rollback of [...progress.appliedUpdates].reverse()) {
    await updateEntry(rollback.entryId, {
      timestamp: rollback.originalTimestamp,
      ...(rollback.originalEntryType !== undefined ? { entryType: rollback.originalEntryType } : {}),
      ...(rollback.originalJobId !== undefined ? { jobId: rollback.originalJobId } : {}),
    });
  }

  for (const entry of progress.createdEntries.reverse()) {
    await deleteEntry(entry.id);
  }
}

/**
 * The changed timestamps in application order: entries that move later first
 * (latest original first), then entries that move earlier (earliest first),
 * so no intermediate state overlaps a neighbor.
 */
function collectEntryTimestampUpdates(
  snapshot: EntryDetailsSnapshot,
  draft: EntryDetailsDraft,
): EntryTimestampUpdate[] {
  const { startEntry, clockInDate, actualClockOutEntry, clockOutDate, isAutomaticBreakMode } = snapshot;
  const { editedClockIn, editedClockOut, editedBreaks } = draft;
  const updates: Array<{
    entryId: string;
    originalTimestamp: string;
    nextTimestamp: string;
  }> = [];

  if (startEntry && editedClockIn && clockInDate) {
    if (editedClockIn.getTime() !== clockInDate.getTime()) {
      updates.push({
        entryId: startEntry.id,
        originalTimestamp: startEntry.timestamp,
        nextTimestamp: editedClockIn.toISOString(),
      });
    }
  }

  if (actualClockOutEntry && editedClockOut && clockOutDate) {
    if (editedClockOut.getTime() !== clockOutDate.getTime()) {
      updates.push({
        entryId: actualClockOutEntry.id,
        originalTimestamp: actualClockOutEntry.timestamp,
        nextTimestamp: editedClockOut.toISOString(),
      });
    }
  }

  if (!isAutomaticBreakMode) {
    for (const workBreak of editedBreaks) {
      if (
        workBreak.breakStartEntry &&
        workBreak.breakStart.getTime() !== new Date(workBreak.breakStartEntry.timestamp).getTime()
      ) {
        updates.push({
          entryId: workBreak.breakStartEntry.id,
          originalTimestamp: workBreak.breakStartEntry.timestamp,
          nextTimestamp: workBreak.breakStart.toISOString(),
        });
      }

      if (
        workBreak.breakEndEntry &&
        workBreak.breakEnd &&
        workBreak.breakEnd.getTime() !== new Date(workBreak.breakEndEntry.timestamp).getTime()
      ) {
        updates.push({
          entryId: workBreak.breakEndEntry.id,
          originalTimestamp: workBreak.breakEndEntry.timestamp,
          nextTimestamp: workBreak.breakEnd.toISOString(),
        });
      }
    }
  }

  const laterUpdates = updates
    .filter(
      (update) => new Date(update.nextTimestamp).getTime() > new Date(update.originalTimestamp).getTime(),
    )
    .sort((a, b) => new Date(b.originalTimestamp).getTime() - new Date(a.originalTimestamp).getTime());

  const earlierUpdates = updates
    .filter(
      (update) => new Date(update.nextTimestamp).getTime() < new Date(update.originalTimestamp).getTime(),
    )
    .sort((a, b) => new Date(a.originalTimestamp).getTime() - new Date(b.originalTimestamp).getTime());

  return [...laterUpdates, ...earlierUpdates];
}

/** Each step below reports its own refusal and returns false; the caller rolls back. */
async function applyEntryTimestampUpdates(
  updates: EntryTimestampUpdate[],
  progress: EntrySaveProgress,
  setError: SetEntryDetailsError,
): Promise<boolean> {
  for (const update of updates) {
    const result = await updateEntry(update.entryId, {
      timestamp: update.nextTimestamp,
    });

    if (!result.success) {
      setError(formatActionError(result.error));
      return false;
    }

    if ('request' in result) {
      progress.requestCreated = true;
    }

    progress.appliedUpdates.push({
      entryId: update.entryId,
      originalTimestamp: update.originalTimestamp,
    });
  }

  return true;
}

async function createNewEntryBreaks(
  newBreaks: EditableBreak[],
  { entryOrganizationId, entryUserId }: EntryDetailsSnapshot,
  progress: EntrySaveProgress,
  setError: SetEntryDetailsError,
): Promise<boolean> {
  if (newBreaks.length === 0) return true;

  if (!entryOrganizationId || !entryUserId) {
    setError('Die Pause konnte nicht zugeordnet werden.');
    return false;
  }

  for (const workBreak of newBreaks) {
    if (!workBreak.breakEnd) {
      setError('Bitte gib für die neue Pause auch ein Pausenende an.');
      return false;
    }

    const result = await addManualEntry({
      organizationId: entryOrganizationId,
      targetUserId: entryUserId,
      entries: [
        {
          entryType: 'break_start',
          timestamp: workBreak.breakStart.toISOString(),
        },
        {
          entryType: 'break_end',
          timestamp: workBreak.breakEnd.toISOString(),
        },
      ],
    });

    if (!result.success) {
      setError(formatActionError(result.error));
      return false;
    }

    progress.createdEntries.push(...result.entries);
  }

  return true;
}

async function deleteRemovedEntryBreaks(
  removedBreaks: EditableBreak[],
  session: WorkSession,
  { actualClockOutEntry }: EntryDetailsSnapshot,
  progress: EntrySaveProgress,
  setError: SetEntryDetailsError,
): Promise<boolean> {
  for (const removedBreak of removedBreaks) {
    if (!removedBreak.breakStartEntry) continue;

    const convertsBoundaryToClockOut =
      !actualClockOutEntry &&
      !!removedBreak.breakEndEntry &&
      removedBreak.breakEndEntry?.id === session.clockOut?.id &&
      removedBreak.breakEndEntry.entryType === 'break_end';

    if (convertsBoundaryToClockOut && removedBreak.breakEndEntry) {
      const convertedResult = await updateEntry(removedBreak.breakEndEntry.id, {
        entryType: 'clock_out',
        jobId: null,
      });

      if (!convertedResult.success) {
        setError(formatActionError(convertedResult.error));
        return false;
      }

      if ('request' in convertedResult) {
        progress.requestCreated = true;
      }

      progress.appliedUpdates.push({
        entryId: removedBreak.breakEndEntry.id,
        originalTimestamp: removedBreak.breakEndEntry.timestamp,
        originalEntryType: removedBreak.breakEndEntry.entryType,
        originalJobId: removedBreak.breakEndEntry.jobId,
      });
    }

    const result = await deleteEntry(
      removedBreak.breakStartEntry.id,
      convertsBoundaryToClockOut ? undefined : removedBreak.breakEndEntry?.id,
    );

    if (!result.success) {
      setError(formatActionError(result.error));
      return false;
    }

    if ('request' in result) {
      progress.requestCreated = true;
    }
  }

  return true;
}

export function saveEntryDetailsEdit({
  context,
  session,
  snapshot,
  draft,
  displayedBreaks,
}: {
  context: EntryDetailsCommandContext;
  session: WorkSession;
  snapshot: EntryDetailsSnapshot;
  draft: EntryDetailsDraft;
  displayedBreaks: EditableBreak[];
}): void {
  const { runAction, showBanner, setError, onRefresh } = context;
  const { hasCanonicalSegment, isAutomaticBreakMode } = snapshot;
  const { setIsEditing, editedBreaks, removedBreaks } = draft;
  setError(null);

  if (hasCanonicalSegment) {
    setIsEditing(false);
    setError('Kanonische Zeitsegmente können hier nicht bearbeitet werden.');
    return;
  }

  const validationError = validateEntryDetailsTimeline({
    editedClockIn: draft.editedClockIn,
    editedClockOut: draft.editedClockOut,
    displayedBreaks,
    clockInDate: snapshot.clockInDate,
    clockOutDate: snapshot.clockOutDate,
  });
  if (validationError) {
    setError(validationError);
    return;
  }

  void runAction('save', async () => {
    const progress: EntrySaveProgress = {
      requestCreated: false,
      appliedUpdates: [],
      createdEntries: [],
    };

    try {
      const updates = collectEntryTimestampUpdates(snapshot, draft);
      const newBreaks = isAutomaticBreakMode ? [] : editedBreaks.filter((workBreak) => workBreak.isNew);
      const applied =
        (await applyEntryTimestampUpdates(updates, progress, setError)) &&
        (await createNewEntryBreaks(newBreaks, snapshot, progress, setError)) &&
        (await deleteRemovedEntryBreaks(
          isAutomaticBreakMode ? [] : removedBreaks,
          session,
          snapshot,
          progress,
          setError,
        ));

      if (!applied) {
        await rollbackEntrySave(progress);
        return;
      }

      if (progress.requestCreated) {
        setIsEditing(false);
        closeEntryDetailsWithRequest(context, 'Änderungsantrag wurde zur Genehmigung eingereicht.');
        return;
      }

      setIsEditing(false);
      showBanner({
        variant: 'success',
        message: 'Arbeitszeit wurde gespeichert.',
      });
      onRefresh();
    } catch {
      setError('Die Änderung konnte nicht gespeichert werden. Bitte versuche es erneut.');
    }
  });
}
