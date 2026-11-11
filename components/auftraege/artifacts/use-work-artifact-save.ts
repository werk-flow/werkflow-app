'use client';

import type { RefObject } from 'react';

import { useBanner } from '@/components/ui/banner';
import { focusFirstInvalidField, REASON_MIN_3_MESSAGE } from '@/lib/ui/field-validation';
import { saveWorkArtifact } from '@/lib/work-artifacts/actions';
import { workArtifactFieldIssues } from '@/lib/work-artifacts/field-rules';
import type { DeviceDraftHandle } from './use-device-drafts';
import type { WorkArtifactEditor } from './use-work-artifact-editor';
import type { WorkArtifactTarget } from '@/lib/work-artifacts/types';
import { contentForKind, iso, savedContent } from './work-artifact-content';
import { workArtifactFieldErrors } from './work-artifact-field-errors';

type WorkArtifactSaveOptions = WorkArtifactTarget & {
  editor: WorkArtifactEditor;
  /** The id a new Arbeitsnachweis gets, shared with its draft on the device. */
  newArtifactId: string;
  /** The keeper of the new Arbeitsnachweis as a draft on this device, while the dialog shows one. */
  deviceDraft: RefObject<DeviceDraftHandle | null>;
};

/**
 * Saves the draft as a new revision, optionally submitting it for review. A new Arbeitsnachweis
 * of a job with photos, or one whose save got no answer, goes through its draft on the device.
 */
export function useWorkArtifactSave({
  targetType,
  targetId,
  editor,
  newArtifactId,
  deviceDraft,
}: WorkArtifactSaveOptions): (submit: boolean) => void {
  const { detail, currentRevision, requiresCorrectionReason, kind, title, content, correctionReason } =
    editor;
  const { showBanner } = useBanner();

  /** The save over the network; `no_answer` when the request never returned and the device keeps the draft. */
  async function saveOnServer(submit: boolean, onDevice: boolean) {
    try {
      return await saveWorkArtifact({
        artifactId: detail?.id ?? newArtifactId,
        revisionId: crypto.randomUUID(),
        expectedVersion: detail?.version ?? null,
        targetType,
        targetId,
        kind,
        visibility: editor.visibility,
        capturedAt: iso(editor.capturedAt) ?? new Date().toISOString(),
        title,
        content: savedContent(kind, content),
        ...(requiresCorrectionReason && currentRevision ? { correctsRevisionId: currentRevision.id } : {}),
        ...(requiresCorrectionReason ? { correctionReason } : {}),
        submit,
        ...(submit ? { submitActionId: crypto.randomUUID() } : {}),
      });
    } catch (error) {
      // Only a draft on the device has somewhere to wait for the signal.
      if (!onDevice) throw error;
      return 'no_answer' as const;
    }
  }

  async function runSave(submit: boolean): Promise<void> {
    const onDevice = deviceDraft.current;
    // Photos reach the server only with the draft the device holds.
    const result =
      onDevice && onDevice.photoCount > 0 ? 'no_answer' : await saveOnServer(submit, onDevice !== null);
    if (result === 'no_answer') {
      await onDevice?.save(submit);
      return;
    }
    if (!result.success) {
      await editor.handleMutationFailure(
        result,
        'Der Arbeitsnachweis konnte nicht gespeichert werden.',
        false,
      );
      return;
    }
    // The server holds it now: the copy on the device goes.
    await onDevice?.discard();
    // The save returns the stored detail; only a failed read after the write needs a second round trip.
    if (result.artifact) editor.applyDetail(result.artifact);
    else await editor.load(result.artifactId);
    editor.setEditing(false);
    editor.setAttemptedSave(null);
    editor.setCorrectionReason('');
    showBanner({
      variant: 'success',
      message: submit
        ? 'Arbeitsnachweis wurde zur Prüfung eingereicht.'
        : 'Arbeitsnachweis wurde gespeichert.',
    });
  }

  return function save(submit: boolean) {
    const draftContent = contentForKind(kind, content);
    // The save schema's own field rules mark and focus the fields before the request.
    const issues = workArtifactFieldIssues({ kind, title, submit, content: draftContent });
    const reasonError =
      requiresCorrectionReason && correctionReason.trim().length < 3 ? REASON_MIN_3_MESSAGE : undefined;
    editor.setAttemptedSave({ submit });
    editor.setCorrectionReasonError(reasonError ?? null);
    const errors = { ...workArtifactFieldErrors(issues), 'artifact-correction-reason': reasonError };
    if (focusFirstInvalidField(errors)) return;
    editor.setError(null);
    void editor.runArtifactTask(submit ? 'submit' : 'draft', () => runSave(submit));
  };
}
