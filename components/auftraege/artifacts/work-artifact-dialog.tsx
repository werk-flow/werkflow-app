'use client';

import { useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { OrganizationDocument } from '@/lib/documents/types';
import {
  WORK_ARTIFACT_KIND_LABELS,
  WORK_ARTIFACT_STATUS_LABELS,
  type RecordedVisitWindow,
  type WorkArtifactSummary,
  type WorkArtifactTarget,
  type WorkArtifactTimeSourceOption,
} from '@/lib/work-artifacts/types';
import { DeviceDraftKeeper } from './device-draft-keeper';
import type { DeviceDraftHandle, DraftDevice, RestoredDraft } from './use-device-drafts';
import { useWorkArtifactCustomerActions } from './use-work-artifact-customer-actions';
import { useWorkArtifactEditor, type WorkArtifactEditor } from './use-work-artifact-editor';
import { useWorkArtifactLinks } from './use-work-artifact-links';
import { useWorkArtifactReviewActions } from './use-work-artifact-review-actions';
import { useWorkArtifactSave } from './use-work-artifact-save';
import type { WorkArtifactEvidenceRequirement } from './work-artifact-content';
import { ArtifactDetail } from './work-artifact-detail';
import {
  WorkArtifactDialogActions,
  WorkArtifactDialogSkeleton,
  WorkArtifactDraftForm,
  WorkArtifactRemoteUpdateHint,
} from './work-artifacts-section-dialog-parts';

// The dialog of one Arbeitsnachweis, and with it everything only that dialog
// and the drafts on the device need. The section loads this module on the
// first open, or when the device may hold a draft: the job list prefetches a
// job page's own code, so nothing here counts toward the field cold start.

export { DeviceDrafts } from './device-drafts';

export type WorkArtifactDialogProps = WorkArtifactTarget & {
  artifactId: string | null;
  initialSummary: WorkArtifactSummary | null;
  isManager: boolean;
  canApprove: boolean;
  currentUserId: string;
  documents: OrganizationDocument[];
  evidenceRequirements: WorkArtifactEvidenceRequirement[];
  timeEntryOptions: WorkArtifactTimeSourceOption[];
  recordedVisit: RecordedVisitWindow;
  instructionOptions: Array<{ id: string; label: string }>;
  defaultSiteId?: string | undefined;
  /** The device of a job's section, once the active organization is known; null for a project. */
  draftDevice: DraftDevice | null;
  restoredDraft: RestoredDraft | null;
  remoteVersions: Record<string, number>;
  onRemoteUpdateHandled: () => void;
  onClose: () => void;
  readOnly: boolean;
};

function WorkArtifactDialog(props: WorkArtifactDialogProps) {
  const { readOnly } = props;
  const artifactFormId = useId();
  const { editor, save, review, customer, links, keeper } = useWorkArtifactDialogActions(props);
  const { detail, loading, editing, isBusy, anyBusy, currentRevision } = editor;
  const { requestClose } = customer;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
      pending={anyBusy}
    >
      <DialogContent size="4xl">
        <DialogHeader>
          <DialogTitle>
            {detail ? (currentRevision?.title ?? 'Arbeitsnachweis') : 'Arbeitsnachweis erstellen'}
          </DialogTitle>
          <DialogDescription>{workArtifactDialogDescription(detail, currentRevision)}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-5 py-1">
          <WorkArtifactRemoteUpdateHint {...props} editor={editor} />
          {loading ? (
            <WorkArtifactDialogSkeleton />
          ) : !readOnly && editing ? (
            <form
              id={artifactFormId}
              onSubmit={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (anyBusy || loading || readOnly || !editing) return;
                save(true);
              }}
              noValidate
            >
              <WorkArtifactDraftForm {...props} editor={editor} keeper={keeper} />
            </form>
          ) : detail && currentRevision ? (
            <ArtifactDetail
              detail={detail}
              currentRevision={currentRevision}
              currentUserId={props.currentUserId}
              documents={props.documents}
            />
          ) : null}

          <WorkArtifactDialogActions
            {...props}
            editor={editor}
            review={review}
            customer={customer}
            links={links}
          />
        </DialogBody>
        <DialogFooter>
          <WorkArtifactSecondaryActions
            isBusy={isBusy}
            anyBusy={anyBusy}
            canEdit={!readOnly && editing}
            onClose={requestClose}
            onSaveDraft={() => save(false)}
          />
          {!readOnly && editing && (
            <Button
              pending={isBusy('submit')}
              type="submit"
              form={artifactFormId}
              disabled={anyBusy || loading}
            >
              Zur Prüfung einreichen
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The editor and the action hooks of one open artifact dialog. */
function useWorkArtifactDialogActions({
  targetType,
  targetId,
  artifactId,
  initialSummary,
  defaultSiteId,
  readOnly,
  timeEntryOptions,
  recordedVisit,
  draftDevice,
  restoredDraft,
  onClose,
}: WorkArtifactDialogProps) {
  // The id a new Arbeitsnachweis gets: its draft's on the device, and the server's once it is saved.
  const [newArtifactId] = useState(() => restoredDraft?.draft.id ?? crypto.randomUUID());
  const editor = useWorkArtifactEditor({
    artifactId,
    initialSummary,
    defaultSiteId,
    recordedVisit,
    readOnly,
    restored: restoredDraft?.form ?? null,
  });
  // The keeper of the new Arbeitsnachweis as a draft on this device, while the form shows one.
  const deviceDraft = useRef<DeviceDraftHandle | null>(null);
  const [setDeviceDraft] = useState(() => (handle: DeviceDraftHandle | null) => {
    deviceDraft.current = handle;
  });
  const keeper =
    draftDevice && targetType === 'job' && artifactId === null && !readOnly && editor.detail === null ? (
      <DeviceDraftKeeper
        editor={editor}
        device={draftDevice}
        jobId={targetId}
        artifactId={newArtifactId}
        restored={restoredDraft}
        onHandle={setDeviceDraft}
        onClose={onClose}
      />
    ) : null;
  const save = useWorkArtifactSave({ targetType, targetId, editor, newArtifactId, deviceDraft });
  const review = useWorkArtifactReviewActions(editor);
  const customer = useWorkArtifactCustomerActions({ targetType, targetId, editor, onClose });
  const links = useWorkArtifactLinks({ editor, review, timeEntryOptions });
  return { editor, save, review, customer, links, keeper };
}

function workArtifactDialogDescription(
  detail: WorkArtifactEditor['detail'],
  currentRevision: WorkArtifactEditor['currentRevision'],
): string {
  return detail
    ? `${WORK_ARTIFACT_KIND_LABELS[detail.kind]} · ${WORK_ARTIFACT_STATUS_LABELS[detail.status]} · Version ${currentRevision?.revision_number ?? 1}`
    : 'Strukturierte Dokumentation direkt dem aktuellen Auftrag oder Projekt zuordnen.';
}

/** The footer's close and draft actions; the dialog keeps its submit beside its form. */
function WorkArtifactSecondaryActions({
  isBusy,
  anyBusy,
  canEdit,
  onClose,
  onSaveDraft,
}: {
  isBusy: (state: string) => boolean;
  anyBusy: boolean;
  canEdit: boolean;
  onClose: () => void;
  onSaveDraft: () => void;
}) {
  return (
    <>
      <Button pending={isBusy('close')} type="button" variant="outline" onClick={onClose} disabled={anyBusy}>
        Schließen
      </Button>
      {canEdit && (
        <Button
          pending={isBusy('draft')}
          type="button"
          variant="outline"
          onClick={onSaveDraft}
          disabled={anyBusy}
        >
          Als Entwurf speichern
        </Button>
      )}
    </>
  );
}

/**
 * The dialog as the section's lazy load renders it: mounted while an Arbeitsnachweis is open, so
 * every open starts from that record or draft.
 */
export function WorkArtifactDialogHost({
  open,
  ...dialog
}: WorkArtifactDialogProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  return open ? <WorkArtifactDialog {...dialog} /> : null;
}
