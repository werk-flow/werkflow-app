'use client';

import { useState } from 'react';

import { useBanner } from '@/components/ui/banner';
import { uploadDocumentDirect } from '@/lib/documents/upload-client';
import { discardUnlinkedWorkArtifactSignature, recordWorkArtifactAction } from '@/lib/work-artifacts/actions';
import { WORK_ARTIFACT_LEGAL_NOTICE } from '@/lib/work-artifacts/types';
import type { WorkArtifactEditor } from './use-work-artifact-editor';
import type { WorkArtifactReviewActions } from './use-work-artifact-review-actions';
import type { WorkArtifactTarget } from './work-artifact-content';

type WorkArtifactCustomerActionsOptions = WorkArtifactTarget & {
  editor: WorkArtifactEditor;
  review: WorkArtifactReviewActions;
  onClose: () => void;
};

/** Customer decision, signature capture, and the close flow that discards an unlinked signature upload. */
export function useWorkArtifactCustomerActions({
  targetType,
  targetId,
  editor,
  review,
  onClose,
}: WorkArtifactCustomerActionsOptions) {
  const { detail, currentRevision, load, handleMutationFailure, runArtifactTask, setError } = editor;
  const { actionReason, setActionReason, hasActionReason } = review;
  const { showBanner } = useBanner();
  const [customerName, setCustomerName] = useState('');
  const [customerRole, setCustomerRole] = useState('');
  const [customerRelationship, setCustomerRelationship] = useState('Ansprechperson vor Ort');
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  const [pendingSignatureDocumentId, setPendingSignatureDocumentId] = useState<string | null>(null);
  const [customerNameError, setCustomerNameError] = useState<string | null>(null);

  function hasCustomerName(): boolean {
    const valid = customerName.trim().length >= 2;
    setCustomerNameError(valid ? null : 'Bitte gib den Namen der unterzeichnenden Person an.');
    if (!valid) document.getElementById('artifact-customer-name')?.focus();
    return valid;
  }

  function customerAction(actionType: 'customer_acknowledged' | 'customer_refused' | 'customer_reserved') {
    if (!detail || !currentRevision) return;
    // Refusal and reservation also need the reason. The reason check runs last
    // so focus lands on the reason field, which sits above the name.
    const nameValid = hasCustomerName();
    const reasonValid = actionType === 'customer_acknowledged' || hasActionReason();
    if (!nameValid || !reasonValid) return;
    setError(null);
    void runArtifactTask(actionType, async () => {
      const result = await recordWorkArtifactAction({
        artifactId: detail.id,
        revisionId: currentRevision.id,
        actionId: crypto.randomUUID(),
        expectedVersion: detail.version,
        actionType,
        ...(actionType === 'customer_acknowledged' ? {} : { reason: actionReason }),
        customerContext: {
          signerName: customerName,
          ...(customerRole ? { signerRole: customerRole } : {}),
          signerRelationship: customerRelationship,
          captureMethod: 'Persönlich vor Ort',
          wordingSnapshot: WORK_ARTIFACT_LEGAL_NOTICE,
        },
      });
      if (await handleMutationFailure(result, 'Die Kundenentscheidung konnte nicht gespeichert werden.'))
        return;
      await load(detail.id);
      setActionReason('');
      showBanner({ variant: 'success', message: 'Kundenentscheidung wurde dokumentiert.' });
    });
  }

  function captureSignature() {
    if (!detail || !currentRevision || !hasCustomerName()) return;
    if (!signatureFile) {
      setError('Bitte erfasse zuerst die Unterschrift im Feld oben.');
      return;
    }
    setError(null);
    void runArtifactTask('signature', async () => {
      let signatureDocumentId = pendingSignatureDocumentId;
      if (!signatureDocumentId) {
        const uploaded = await uploadDocumentDirect({
          file: signatureFile,
          target:
            targetType === 'job'
              ? { kind: 'job', jobId: targetId }
              : { kind: 'project', projectId: targetId },
          category: 'photo',
        });
        if (!uploaded.success) {
          setError('Die Unterschrift konnte nicht hochgeladen werden.');
          return;
        }
        signatureDocumentId = uploaded.document.id;
        setPendingSignatureDocumentId(signatureDocumentId);
      }
      const result = await recordWorkArtifactAction({
        artifactId: detail.id,
        revisionId: currentRevision.id,
        actionId: crypto.randomUUID(),
        expectedVersion: detail.version,
        actionType: 'signature_captured',
        customerContext: {
          signerName: customerName,
          ...(customerRole ? { signerRole: customerRole } : {}),
          signerRelationship: customerRelationship,
          captureMethod: 'Unterschrift auf dem Gerät',
          wordingSnapshot: WORK_ARTIFACT_LEGAL_NOTICE,
        },
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
      const discarded = await discardUnlinkedWorkArtifactSignature(pendingSignatureDocumentId).catch(() => ({
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
      setPendingSignatureDocumentId(null);
    }
    onClose();
  }

  function requestClose() {
    void runArtifactTask('close', closeDialog);
  }

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
