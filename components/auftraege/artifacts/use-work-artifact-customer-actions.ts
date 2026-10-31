'use client';

import { useState } from 'react';

import { useBanner } from '@/components/ui/banner';
import type { DocumentUploadTarget } from '@/lib/documents/types';
import { uploadWorkArtifactSignatureDirect } from '@/lib/documents/upload-client';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';
import { discardUnlinkedWorkArtifactSignature, recordWorkArtifactAction } from '@/lib/work-artifacts/actions';
import { WORK_ARTIFACT_LEGAL_NOTICE, type WorkArtifactActionInput } from '@/lib/work-artifacts/types';
import type { WorkArtifactEditor } from './use-work-artifact-editor';
import type { WorkArtifactReviewActions } from './use-work-artifact-review-actions';
import type { WorkArtifactTarget } from '@/lib/work-artifacts/types';

const CUSTOMER_NAME_REQUIRED = 'Bitte gib den Namen der unterzeichnenden Person an.';

type WorkArtifactCustomerActionsOptions = WorkArtifactTarget & {
  editor: WorkArtifactEditor;
  review: WorkArtifactReviewActions;
  onClose: () => void;
};

function signatureUploadTarget({ targetType, targetId }: WorkArtifactTarget): DocumentUploadTarget {
  return targetType === 'job' ? { kind: 'job', jobId: targetId } : { kind: 'project', projectId: targetId };
}

type ShowBanner = ReturnType<typeof useBanner>['showBanner'];

type CustomerSigner = { customerName: string; customerRole: string; customerRelationship: string };

/** The signer facts every customer action records, with the wording the customer saw. */
function signerContext(
  { customerName, customerRole, customerRelationship }: CustomerSigner,
  captureMethod: string,
): NonNullable<WorkArtifactActionInput['customerContext']> {
  return {
    signerName: customerName,
    ...(customerRole ? { signerRole: customerRole } : {}),
    signerRelationship: customerRelationship,
    captureMethod,
    wordingSnapshot: WORK_ARTIFACT_LEGAL_NOTICE,
  };
}

/** Uploads the signature image and returns its document id, or null when the upload failed. */
async function uploadSignature(
  file: File,
  artifactId: string,
  target: WorkArtifactTarget,
): Promise<string | null> {
  const uploaded = await uploadWorkArtifactSignatureDirect({
    file,
    artifactId,
    target: signatureUploadTarget(target),
  });
  return uploaded.success ? uploaded.document.id : null;
}

/** Discards a signature upload no action links; a failure leaves it in the library and says so. */
async function discardPendingSignature(documentId: string, showBanner: ShowBanner): Promise<void> {
  const discarded = await discardUnlinkedWorkArtifactSignature(documentId).catch(() => ({
    success: false as const,
  }));
  if (!discarded.success) {
    // The dialog is closing, so the banner is the only surface left; the
    // orphaned upload stays reachable in the library.
    showBanner({
      variant: 'error',
      message:
        'Die nicht gespeicherte Unterschrift konnte nicht verworfen werden. Sie bleibt unter Dokumente sichtbar und kann dort gelöscht werden.',
    });
  }
}

type CustomerDecisionType = 'customer_acknowledged' | 'customer_refused' | 'customer_reserved';

type CustomerDecisionContext = {
  editor: WorkArtifactEditor;
  review: WorkArtifactReviewActions;
  signer: CustomerSigner;
  showBanner: ShowBanner;
  checkCustomerName: () => string | undefined;
};

/** Records the customer's acknowledgement, refusal or reservation of the current revision. */
function recordCustomerDecision(
  { editor, review, signer, showBanner, checkCustomerName }: CustomerDecisionContext,
  actionType: CustomerDecisionType,
) {
  const { detail, currentRevision, load, handleMutationFailure, runArtifactTask, setError } = editor;
  const { actionReason, setActionReason, checkActionReason } = review;
  if (!detail || !currentRevision) return;
  // Refusal and reservation also need the reason, which sits above the name.
  const reasonError = actionType === 'customer_acknowledged' ? undefined : checkActionReason();
  const errors = { 'artifact-action-reason': reasonError, 'artifact-customer-name': checkCustomerName() };
  if (focusFirstInvalidField(errors)) return;
  setError(null);
  void runArtifactTask(actionType, async () => {
    const result = await recordWorkArtifactAction({
      artifactId: detail.id,
      revisionId: currentRevision.id,
      actionId: crypto.randomUUID(),
      expectedVersion: detail.version,
      actionType,
      ...(actionType === 'customer_acknowledged' ? {} : { reason: actionReason }),
      customerContext: signerContext(signer, 'Persönlich vor Ort'),
    });
    if (await handleMutationFailure(result, 'Die Kundenentscheidung konnte nicht gespeichert werden.'))
      return;
    await load(detail.id);
    setActionReason('');
    showBanner({ variant: 'success', message: 'Kundenentscheidung wurde dokumentiert.' });
  });
}

/** Customer decision, signature capture, and the close flow that discards an unlinked signature upload. */
export function useWorkArtifactCustomerActions({
  targetType,
  targetId,
  editor,
  review,
  onClose,
}: WorkArtifactCustomerActionsOptions) {
  const { detail, currentRevision, load, handleMutationFailure, runArtifactTask, setError } = editor;
  const { showBanner } = useBanner();
  const [customerName, setCustomerName] = useState('');
  const [customerRole, setCustomerRole] = useState('');
  const [customerRelationship, setCustomerRelationship] = useState('Ansprechperson vor Ort');
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  const [pendingSignatureDocumentId, setPendingSignatureDocumentId] = useState<string | null>(null);
  const [customerNameError, setCustomerNameError] = useState<string | null>(null);
  const signer = { customerName, customerRole, customerRelationship };

  /** Marks the name field and returns its message, or undefined when the name is valid. */
  function checkCustomerName(): string | undefined {
    const message = customerName.trim().length >= 2 ? undefined : CUSTOMER_NAME_REQUIRED;
    setCustomerNameError(message ?? null);
    return message;
  }

  const customerAction = (actionType: CustomerDecisionType) =>
    recordCustomerDecision({ editor, review, signer, showBanner, checkCustomerName }, actionType);

  function captureSignature() {
    if (!detail || !currentRevision) return;
    if (focusFirstInvalidField({ 'artifact-customer-name': checkCustomerName() })) return;
    if (!signatureFile) {
      setError('Bitte erfasse zuerst die Unterschrift im Feld oben.');
      return;
    }
    setError(null);
    void runArtifactTask('signature', async () => {
      let signatureDocumentId = pendingSignatureDocumentId;
      if (!signatureDocumentId) {
        signatureDocumentId = await uploadSignature(signatureFile, detail.id, { targetType, targetId });
        if (signatureDocumentId === null) {
          setError('Die Unterschrift konnte nicht hochgeladen werden.');
          return;
        }
        setPendingSignatureDocumentId(signatureDocumentId);
      }
      const result = await recordWorkArtifactAction({
        artifactId: detail.id,
        revisionId: currentRevision.id,
        actionId: crypto.randomUUID(),
        expectedVersion: detail.version,
        actionType: 'signature_captured',
        customerContext: signerContext(signer, 'Unterschrift auf dem Gerät'),
        signatureDocumentId,
      });
      if (await handleMutationFailure(result, 'Die Unterschrift konnte nicht abgeschlossen werden.')) return;
      await load(detail.id);
      setSignatureFile(null);
      setPendingSignatureDocumentId(null);
      showBanner({ variant: 'success', message: 'Unterschrift wurde zur aktuellen Version gespeichert.' });
    });
  }

  async function closeDialog() {
    if (pendingSignatureDocumentId) {
      await discardPendingSignature(pendingSignatureDocumentId, showBanner);
      setPendingSignatureDocumentId(null);
    }
    onClose();
  }

  const requestClose = () => void runArtifactTask('close', closeDialog);

  return {
    customerName,
    setCustomerName,
    customerNameError,
    customerRole,
    setCustomerRole,
    customerRelationship,
    setCustomerRelationship,
    setSignatureFile,
    pendingSignatureDocumentId,
    customerAction,
    captureSignature,
    requestClose,
  };
}

export type WorkArtifactCustomerActions = ReturnType<typeof useWorkArtifactCustomerActions>;
