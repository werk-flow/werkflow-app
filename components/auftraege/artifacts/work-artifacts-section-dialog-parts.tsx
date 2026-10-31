'use client';

import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { SectionError } from '@/components/ui/section-error';
import { Skeleton } from '@/components/ui/skeleton';
import type { OrganizationDocument } from '@/lib/documents/types';
import type { WorkArtifactTimeSourceOption } from '@/lib/work-artifacts/types';
import type { WorkArtifactCustomerActions } from './use-work-artifact-customer-actions';
import type { WorkArtifactEditor } from './use-work-artifact-editor';
import type { WorkArtifactLinks } from './use-work-artifact-links';
import type { WorkArtifactReviewActions } from './use-work-artifact-review-actions';
import { WorkArtifactActionPanel } from './work-artifact-action-panel';
import type { WorkArtifactEvidenceRequirement } from './work-artifact-content';
import { ArtifactForm } from './work-artifact-form';

/** The hint that someone else saved a newer version while the dialog is open. */
export function WorkArtifactRemoteUpdateHint({
  editor,
  remoteVersions,
  onRemoteUpdateHandled,
}: {
  editor: WorkArtifactEditor;
  remoteVersions: Record<string, number>;
  onRemoteUpdateHandled: () => void;
}) {
  const { detail, anyBusy, load } = editor;
  const remoteVersion = detail ? remoteVersions[detail.id] : undefined;
  const hasRemoteUpdate = detail !== null && remoteVersion !== undefined && remoteVersion > detail.version;
  if (!hasRemoteUpdate || !detail) return null;
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 p-3 text-sm">
      <p>Dieser Arbeitsnachweis wurde zwischenzeitlich geändert.</p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={anyBusy}
        onClick={() => {
          // The editor shows the reload until the current version arrives.
          void load(detail.id);
          onRemoteUpdateHandled();
        }}
      >
        Aktualisieren
      </Button>
    </div>
  );
}

export function WorkArtifactDialogSkeleton() {
  return (
    <div className="min-h-48 space-y-4" role="status" aria-busy="true">
      <span className="sr-only">Arbeitsnachweis wird geladen.</span>
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

/** The editable draft inside the dialog's form. */
export function WorkArtifactDraftForm({
  editor,
  instructionOptions,
}: {
  editor: WorkArtifactEditor;
  instructionOptions: Array<{ id: string; label: string }>;
}) {
  const {
    detail,
    kind,
    setKind,
    visibility,
    setVisibility,
    title,
    setTitle,
    capturedAt,
    setCapturedAt,
    content,
    correctionReason,
    setCorrectionReason,
    correctionReasonError,
    requiresCorrectionReason,
    measurementLines,
    patchContent,
  } = editor;
  return (
    <ArtifactForm
      kind={kind}
      setKind={setKind}
      lockedKind={Boolean(detail)}
      visibility={visibility}
      setVisibility={setVisibility}
      title={title}
      setTitle={setTitle}
      capturedAt={capturedAt}
      setCapturedAt={setCapturedAt}
      content={content}
      patchContent={patchContent}
      measurementLines={measurementLines}
      setMeasurementLines={(lines) => patchContent({ measurementLines: lines })}
      instructionOptions={instructionOptions}
      requiresCorrectionReason={requiresCorrectionReason}
      correctionReason={correctionReason}
      correctionReasonError={correctionReasonError}
      setCorrectionReason={setCorrectionReason}
    />
  );
}

/** The saved revision's action panel, the read failure with its retry, and the dialog's error. */
export function WorkArtifactDialogActions({
  editor,
  review,
  customer,
  links,
  readOnly,
  isManager,
  canApprove,
  currentUserId,
  documents,
  timeEntryOptions,
  evidenceRequirements,
}: {
  editor: WorkArtifactEditor;
  review: WorkArtifactReviewActions;
  customer: WorkArtifactCustomerActions;
  links: WorkArtifactLinks;
  readOnly: boolean;
  isManager: boolean;
  canApprove: boolean;
  currentUserId: string;
  documents: OrganizationDocument[];
  timeEntryOptions: WorkArtifactTimeSourceOption[];
  evidenceRequirements: WorkArtifactEvidenceRequirement[];
}) {
  const { detail, editing, currentRevision, error } = editor;
  return (
    <>
      {!readOnly && !editing && detail && currentRevision && detail.status !== 'voided' && (
        <WorkArtifactActionPanel
          detail={detail}
          currentRevision={currentRevision}
          editor={editor}
          review={review}
          customer={customer}
          links={links}
          isManager={isManager}
          canApprove={canApprove}
          currentUserId={currentUserId}
          documents={documents}
          timeEntryOptions={timeEntryOptions}
          evidenceRequirements={evidenceRequirements}
        />
      )}
      {/* A failed read offers its retry in place; the last-known detail stays visible. */}
      {editor.loadFailure && <SectionError failure={editor.loadFailure} />}
      <ErrorText>{error}</ErrorText>
    </>
  );
}
