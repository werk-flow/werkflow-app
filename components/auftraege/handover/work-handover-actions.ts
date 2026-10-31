'use client';

import { focusFirstInvalidField, REASON_MIN_3_MESSAGE } from '@/lib/ui/field-validation';
import {
  previewWorkHandover,
  releaseWorkHandover,
  returnWorkHandoverForCorrection,
  saveWorkHandoverDraft,
  withdrawWorkHandover,
} from '@/lib/work-handover/actions';
import type { WorkHandoverWorkspace } from '@/lib/work-handover/types';
import type { WorkHandoverReview } from './use-work-handover-review';
import { openDocument } from './work-handover-document';

function renderHtmlPreview(previewWindow: Window, html: string): void {
  const blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  previewWindow.addEventListener('load', () => URL.revokeObjectURL(blobUrl), { once: true });
  previewWindow.location.replace(blobUrl);
}

/** The workspace and the current render's review state every handover write builds on. */
type WorkHandoverWriteContext = {
  initialWorkspace: WorkHandoverWorkspace;
  review: WorkHandoverReview;
};

type WorkHandoverReleaseErrors = {
  'handover-override-reason': string | undefined;
  'handover-reason': string | undefined;
};

function saveHandoverDraft({ initialWorkspace, review }: WorkHandoverWriteContext): void {
  const {
    refreshRoute,
    selectedKeys,
    setLocalPackageVersion,
    setDirty,
    setPreview,
    setFeedback,
    runHandoverTask,
    packageVersion,
    succeed,
    failWithCode,
  } = review;
  setFeedback(null);
  void runHandoverTask('draft', async () => {
    const result = await saveWorkHandoverDraft({
      targetType: initialWorkspace.targetType,
      targetId: initialWorkspace.targetId,
      packageId: initialWorkspace.packageId,
      expectedPackageVersion: packageVersion,
      requestId: crypto.randomUUID(),
      selectedSourceKeys: selectedKeys,
    });
    if (!result.success) {
      failWithCode('draft', result.error);
      return;
    }
    setLocalPackageVersion({ base: packageVersion, value: result.packageVersion });
    setDirty(false);
    setPreview(null);
    succeed('draft', 'Entwurf gespeichert.');
    refreshRoute();
  });
}

function createHandoverPreview({ initialWorkspace, review }: WorkHandoverWriteContext): void {
  const { setPreview, setFeedback, runHandoverTask, packageVersion, succeed, fail, failWithCode } = review;
  setFeedback(null);
  const previewWindow = window.open('about:blank', '_blank');
  if (!previewWindow) {
    fail('preview', 'Der Browser hat die Vorschau blockiert. Erlaube Pop-ups und versuche es erneut.');
    return;
  }
  previewWindow.opener = null;
  previewWindow.document.title = 'Übergabepaket wird erstellt';
  previewWindow.document.body.textContent = 'Vorschau wird erstellt…';
  const identity = {
    releaseId: crypto.randomUUID(),
    requestId: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    documentLinkId: crypto.randomUUID(),
  };
  void runHandoverTask('preview', async () => {
    const result = await previewWorkHandover({
      targetType: initialWorkspace.targetType,
      targetId: initialWorkspace.targetId,
      packageId: initialWorkspace.packageId,
      expectedPackageVersion: packageVersion,
      releaseId: identity.releaseId,
    });
    if (!result.success) {
      previewWindow.close();
      failWithCode('preview', result.error);
      return;
    }
    setPreview({ ...identity, contentHash: result.contentHash, packageVersion });
    renderHtmlPreview(previewWindow, result.html);
    succeed('preview', 'Vorschau erstellt. Prüfe das geöffnete Dokument vor der Freigabe.');
  });
}

function releaseHandover(
  { initialWorkspace, review }: WorkHandoverWriteContext,
  releaseErrors: WorkHandoverReleaseErrors,
): void {
  const {
    refreshRoute,
    reason,
    overrideReason,
    setAttempted,
    preview,
    setPreview,
    setFeedback,
    runHandoverTask,
    overrideable,
    packageVersion,
    succeed,
    failWithCode,
  } = review;
  if (!preview || preview.packageVersion !== packageVersion) return;
  setAttempted('release');
  if (focusFirstInvalidField(releaseErrors)) return;
  setFeedback(null);
  void runHandoverTask('release', async () => {
    const result = await releaseWorkHandover({
      targetType: initialWorkspace.targetType,
      targetId: initialWorkspace.targetId,
      packageId: initialWorkspace.packageId,
      expectedPackageVersion: packageVersion,
      expectedExecutionVersion: initialWorkspace.executionVersion,
      releaseId: preview.releaseId,
      requestId: preview.requestId,
      documentId: preview.documentId,
      documentLinkId: preview.documentLinkId,
      expectedContentHash: preview.contentHash,
      reason,
      overrideGates: overrideable.length > 0,
      overrideReason: overrideable.length > 0 ? overrideReason : undefined,
    });
    if (!result.success) {
      failWithCode('release', result.error);
      return;
    }
    succeed('release', 'Übergabepaket freigegeben und an das Büro übergeben.');
    setPreview(null);
    refreshRoute();
  });
}

function reopenHandover(
  { initialWorkspace, review }: WorkHandoverWriteContext,
  operation: 'withdraw' | 'correction',
  reopenReasonError: string | undefined,
): void {
  const {
    refreshRoute,
    reopenReason,
    setAttempted,
    setFeedback,
    runHandoverTask,
    packageVersion,
    succeed,
    failWithCode,
  } = review;
  setAttempted(operation);
  if (focusFirstInvalidField({ [`handover-${operation}-reason`]: reopenReasonError })) return;
  setFeedback(null);
  void runHandoverTask(operation, async () => {
    const action = operation === 'withdraw' ? withdrawWorkHandover : returnWorkHandoverForCorrection;
    const result = await action({
      targetType: initialWorkspace.targetType,
      targetId: initialWorkspace.targetId,
      packageId: initialWorkspace.packageId,
      requestId: crypto.randomUUID(),
      expectedPackageVersion: packageVersion,
      expectedExecutionVersion: initialWorkspace.executionVersion,
      reason: reopenReason,
    });
    if (!result.success) {
      failWithCode(operation, result.error);
      return;
    }
    succeed(
      operation,
      operation === 'withdraw'
        ? 'Übergabe zurückgenommen. Ein neuer Entwurf kann vorbereitet werden.'
        : 'Ausführung zur Korrektur geöffnet.',
    );
    refreshRoute();
  });
}

function downloadHandoverReleaseDocument(review: WorkHandoverReview, documentId: string): void {
  const { setFeedback, runHandoverTask, fail } = review;
  setFeedback(null);
  // Opened synchronously in the click so pop-up blockers accept the window.
  const openPromise = openDocument(documentId);
  void runHandoverTask('document', async () => {
    const downloadError = await openPromise;
    if (downloadError) fail('document', downloadError);
  });
}

/** The writes of the handover card, bound to the current render's review state. */
export function createWorkHandoverActions(
  initialWorkspace: WorkHandoverWorkspace,
  review: WorkHandoverReview,
) {
  const context: WorkHandoverWriteContext = { initialWorkspace, review };
  const { reason, overrideReason, reopenReason, overrideable } = review;

  const reopenReasonError = reopenReason.trim().length < 3 ? REASON_MIN_3_MESSAGE : undefined;
  const releaseErrors: WorkHandoverReleaseErrors = {
    'handover-override-reason':
      overrideable.length > 0 && overrideReason.trim().length < 3 ? REASON_MIN_3_MESSAGE : undefined,
    'handover-reason':
      reason.trim().length < 3 ? 'Bitte gib einen Übergabevermerk mit mindestens 3 Zeichen an.' : undefined,
  };

  return {
    saveDraft: (): void => saveHandoverDraft(context),
    createPreview: (): void => createHandoverPreview(context),
    reopenReasonError,
    releaseErrors,
    release: (): void => releaseHandover(context, releaseErrors),
    reopen: (operation: 'withdraw' | 'correction'): void =>
      reopenHandover(context, operation, reopenReasonError),
    downloadReleaseDocument: (documentId: string): void =>
      downloadHandoverReleaseDocument(review, documentId),
  };
}

export type WorkHandoverActions = ReturnType<typeof createWorkHandoverActions>;
