// Delete and review commands of the calendar entry details dialog, and the
// context every dialog command (including the save in entry-details-save.ts)
// reports through.

import type { useBanner } from '@/components/ui/banner';
import { describeBatchRefusal } from '@/lib/action-messages';
import { deleteEntriesBatch, deleteEntry, reviewEntries, updateEntry } from '@/lib/time-tracking/actions';
import type { TimeEntry } from '@/lib/time-tracking/types';
import { formatActionError } from './entry-details-labels';
import type { EntryDetailsSnapshot } from './use-entry-details-session';

export type EntryDetailsActionId = 'save' | 'delete' | 'approve' | 'reject';

export type EntryDetailsCommandContext = {
  runAction: <Result>(id: EntryDetailsActionId, task: () => Promise<Result>) => Promise<Result>;
  showBanner: ReturnType<typeof useBanner>['showBanner'];
  setError: (error: string | null) => void;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => void;
};

/** A submitted request closes the dialog at once; the banner confirms it. */
export function closeEntryDetailsWithRequest(
  { onOpenChange, showBanner, onRefresh }: EntryDetailsCommandContext,
  message: string,
): void {
  onOpenChange(false);
  showBanner({ variant: 'success', message });
  onRefresh();
}

export function deleteEntryDetailsBlock(
  context: EntryDetailsCommandContext,
  snapshot: EntryDetailsSnapshot,
): void {
  const { runAction, showBanner, setError, onOpenChange, onRefresh } = context;
  const { isActiveBlock, startEntry, sessionEntriesForReview } = snapshot;
  setError(null);

  void runAction('delete', async () => {
    try {
      let requestCreated = false;
      const shouldConvertActiveBreakBoundaryToClockOut =
        isActiveBlock && startEntry?.entryType === 'break_end' && sessionEntriesForReview.length === 1;

      if (shouldConvertActiveBreakBoundaryToClockOut && startEntry) {
        const result = await updateEntry(startEntry.id, {
          entryType: 'clock_out',
          jobId: null,
        });

        if (!result.success) {
          setError(formatActionError(result.error));
          return;
        }

        if ('request' in result) {
          requestCreated = true;
        }

        if (requestCreated) {
          closeEntryDetailsWithRequest(context, 'Änderungsantrag wurde zur Genehmigung eingereicht.');
          return;
        }

        onOpenChange(false);
        showBanner({
          variant: 'success',
          message: 'Arbeitsblock wurde gelöscht.',
        });
        onRefresh();
        return;
      }

      const entryIds = [...new Set(sessionEntriesForReview.map((entry) => entry.id))];

      if (entryIds.length > 1) {
        const result = await deleteEntriesBatch(entryIds);
        if (!result.success) {
          setError(describeBatchRefusal(result.error, formatActionError(result.error)));
          return;
        }
      } else {
        for (const entry of [...sessionEntriesForReview].reverse()) {
          const result = await deleteEntry(entry.id);

          if (!result.success) {
            setError(formatActionError(result.error));
            return;
          }

          if ('request' in result) {
            requestCreated = true;
          }
        }
      }

      if (requestCreated) {
        closeEntryDetailsWithRequest(context, 'Löschantrag wurde zur Genehmigung eingereicht.');
        return;
      }

      onOpenChange(false);
      showBanner({
        variant: 'success',
        message: 'Arbeitsblock wurde gelöscht.',
      });
      onRefresh();
    } catch {
      setError('Der Arbeitsblock konnte nicht gelöscht werden. Bitte versuche es erneut.');
    }
  });
}

export function reviewEntryDetailsEntries(
  { runAction, showBanner, setError, onRefresh }: EntryDetailsCommandContext,
  pendingEntries: TimeEntry[],
  decision: 'approved' | 'rejected',
): void {
  setError(null);
  const isApproval = decision === 'approved';
  void runAction(isApproval ? 'approve' : 'reject', async () => {
    try {
      const result = await reviewEntries(
        pendingEntries.map((entry) => entry.id),
        decision,
      );
      if (!result.success) {
        setError(describeBatchRefusal(result.error, formatActionError(result.error)));
        return;
      }

      showBanner({
        variant: 'success',
        message: isApproval ? 'Eintrag wurde genehmigt.' : 'Eintrag wurde abgelehnt.',
      });
      onRefresh();
    } catch {
      setError(
        isApproval
          ? 'Die Genehmigung konnte nicht gespeichert werden. Bitte versuche es erneut.'
          : 'Die Ablehnung konnte nicht gespeichert werden. Bitte versuche es erneut.',
      );
    }
  });
}
