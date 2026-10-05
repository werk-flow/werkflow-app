'use client';

import { useState } from 'react';

import { useBanner } from '@/components/ui/banner';
import { REASON_MIN_3_MESSAGE } from '@/lib/ui/field-validation';
import { recordWorkArtifactAction, voidWorkArtifact } from '@/lib/work-artifacts/actions';
import type { WorkArtifactActionType } from '@/lib/work-artifacts/types';
import type { WorkArtifactEditor } from './use-work-artifact-editor';

/** The shared action reason and the review transitions and voiding that require it. */
export function useWorkArtifactReviewActions(editor: WorkArtifactEditor) {
  const { detail, currentRevision, load, handleMutationFailure, runArtifactTask, setError } = editor;
  const { showBanner } = useBanner();
  const [actionReason, setActionReason] = useState('');
  const [actionReasonError, setActionReasonError] = useState<string | null>(null);

  // The reason and the customer name feed several actions below; an action
  // that needs one marks the field and takes focus there instead of sitting
  // disabled without a hint.
  function hasActionReason(): boolean {
    const valid = actionReason.trim().length >= 3;
    setActionReasonError(valid ? null : REASON_MIN_3_MESSAGE);
    if (!valid) document.getElementById('artifact-action-reason')?.focus();
    return valid;
  }

  function act(actionType: WorkArtifactActionType, reason?: string) {
    if (!detail || !currentRevision) return;
    if (reason !== undefined && !hasActionReason()) return;
    setError(null);
    void runArtifactTask(actionType, async () => {
      const result = await recordWorkArtifactAction({
        artifactId: detail.id,
        revisionId: currentRevision.id,
        actionId: crypto.randomUUID(),
        expectedVersion: detail.version,
        actionType,
        ...(reason !== undefined ? { reason } : {}),
      });
      if (
        await handleMutationFailure(
          result,
          'Die Aktion konnte nicht gespeichert werden. Prüfe Berechtigung und aktuellen Stand.',
        )
      )
        return;
      await load(detail.id);
      setActionReason('');
      showBanner({ variant: 'success', message: 'Aktion wurde gespeichert.' });
    });
  }

  function setVoid() {
    if (!detail || !hasActionReason()) return;
    setError(null);
    void runArtifactTask('void', async () => {
      const result = await voidWorkArtifact({
        artifactId: detail.id,
        actionId: crypto.randomUUID(),
        expectedVersion: detail.version,
        reason: actionReason,
      });
      if (await handleMutationFailure(result, 'Der Arbeitsnachweis konnte nicht ungültig gesetzt werden.'))
        return;
      await load(detail.id);
      setActionReason('');
      showBanner({ variant: 'success', message: 'Arbeitsnachweis wurde ungültig gesetzt.' });
    });
  }

  return { actionReason, setActionReason, actionReasonError, hasActionReason, act, setVoid };
}

export type WorkArtifactReviewActions = ReturnType<typeof useWorkArtifactReviewActions>;
