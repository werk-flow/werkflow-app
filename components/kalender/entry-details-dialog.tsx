'use client';

import { useId } from 'react';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useBanner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import type { WorkSession } from '@/lib/time-tracking/types';
import type { OrgRole } from '@/lib/members/actions';
import {
  deleteEntryDetailsBlock,
  reviewEntryDetailsEntries,
  type EntryDetailsActionId,
  type EntryDetailsCommandContext,
} from './entry-details-commands';
import { EntryDetailsContent } from './entry-details-content';
import { EntryDetailsManageActions, EntryDetailsReviewActions } from './entry-details-footer-actions';
import { getEntryDetailsDescription } from './entry-details-labels';
import { getEntryDetailsPermissions } from './entry-details-permissions';
import { saveEntryDetailsEdit } from './entry-details-save';
import { useEntryDetailsDisplayedBreaks } from './use-entry-details-displayed-breaks';
import { useEntryDetailsDraft } from './use-entry-details-draft';
import { useEntryDetailsResolvedJob } from './use-entry-details-resolved-job';
import { useEntryDetailsSession } from './use-entry-details-session';

interface EntryDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: WorkSession;
  currentUserRole: OrgRole;
  currentUserId?: string | undefined;
  onRefresh: () => void;
  startInEditMode?: boolean | undefined;
  jobName?: string | null | undefined;
  entryUserRole?: OrgRole | undefined;
}

export function EntryDetailsDialog({
  open,
  onOpenChange,
  session,
  currentUserRole,
  currentUserId,
  onRefresh,
  startInEditMode = false,
  jobName,
  entryUserRole,
}: EntryDetailsDialogProps) {
  // One flow per action id so the clicked button carries the spinner while
  // the other footer buttons only lock (feedback canon: edit from a dialog).
  const { run: runAction, isBusy, anyBusy: isPending } = useBusyIds<EntryDetailsActionId>();
  const { showBanner } = useBanner();
  const router = useRouter();
  const snapshot = useEntryDetailsSession(session);
  const { resolvedJob, jobDetailUrl } = useEntryDetailsResolvedJob({
    open,
    session,
    jobName,
  });
  const editFormId = useId();
  const draft = useEntryDetailsDraft({ open, startInEditMode, snapshot });
  const { isEditing, handleStartEdit, handleCancelEdit } = draft;
  const breaks = useEntryDetailsDisplayedBreaks(snapshot, draft);
  const { canEdit, canApprove, pendingEntries, hasPendingEntry } = getEntryDetailsPermissions({
    snapshot,
    currentUserRole,
    currentUserId,
    entryUserRole,
  });

  const commandContext: EntryDetailsCommandContext = {
    runAction,
    showBanner,
    setError: draft.setError,
    onOpenChange,
    onRefresh,
  };
  const handleSaveEdit = () =>
    saveEntryDetailsEdit({
      context: commandContext,
      session,
      snapshot,
      draft,
      displayedBreaks: breaks.displayedBreaks,
    });
  const handleDelete = () => deleteEntryDetailsBlock(commandContext, snapshot);
  const handleReview = (decision: 'approved' | 'rejected') =>
    reviewEntryDetailsEntries(commandContext, pendingEntries, decision);

  const entryContent = (
    <EntryDetailsContent
      session={session}
      snapshot={snapshot}
      draft={draft}
      breaks={breaks}
      resolvedJob={resolvedJob}
      jobDetailUrl={jobDetailUrl}
      canEdit={canEdit}
      onNavigate={(url) => {
        onOpenChange(false);
        router.push(url);
      }}
    />
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange} pending={isPending}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Eintrag Details</DialogTitle>
          <DialogDescription>{getEntryDetailsDescription(session, snapshot.isOrphan)}</DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {isEditing ? (
            <form
              id={editFormId}
              onSubmit={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (isPending || !isEditing) return;
                handleSaveEdit();
              }}
              noValidate
              className="space-y-4"
            >
              {entryContent}
            </form>
          ) : (
            entryContent
          )}
        </DialogBody>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          {canApprove && !isEditing && (
            <EntryDetailsReviewActions isPending={isPending} isBusy={isBusy} onReview={handleReview} />
          )}

          {canEdit && !isEditing && (
            <EntryDetailsManageActions
              isPending={isPending}
              isBusy={isBusy}
              hasPendingEntry={hasPendingEntry}
              onStartEdit={handleStartEdit}
              onDelete={handleDelete}
            />
          )}

          {isEditing && (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCancelEdit}
                disabled={isPending}
              >
                Abbrechen
              </Button>
              <Button pending={isBusy('save')} type="submit" form={editFormId} size="sm" disabled={isPending}>
                Speichern
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
