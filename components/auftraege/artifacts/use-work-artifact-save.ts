'use client';

import type { RefObject } from 'react';

import { useBanner } from '@/components/ui/banner';
import { focusFirstInvalidField, REASON_MIN_3_MESSAGE } from '@/lib/ui/field-validation';
import { recordWorkArtifactAction, saveWorkArtifact } from '@/lib/work-artifacts/actions';
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

const SAVED_MESSAGE = 'Arbeitsnachweis wurde gespeichert.';
const SUBMITTED_MESSAGE = 'Arbeitsnachweis wurde zur Prüfung eingereicht.';

/** Shows the draft the device just sent; a submit asks for its review now that the server holds it. */
function useSentDraft(editor: WorkArtifactEditor, newArtifactId: string) {
  const { showBanner } = useBanner();
  return async function showSentDraft(submit: boolean, sent: { revisionId: string; version: number }) {
    let submitted = !submit;
    if (submit) {
      // A request without an answer leaves the draft saved, not submitted: the editor says so.
      const review = await recordWorkArtifactAction({
        artifactId: newArtifactId,
        revisionId: sent.revisionId,
        actionId: crypto.randomUUID(),
        expectedVersion: sent.version,
        actionType: 'review_requested',
      }).catch(() => null);
      submitted = review?.success === true;
    }
    await editor.load(newArtifactId);
    editor.setEditing(false);
    editor.setAttemptedSave(null);
    if (submitted) showBanner({ variant: 'success', message: submit ? SUBMITTED_MESSAGE : SAVED_MESSAGE });
    else
      editor.setError(
        'Der Entwurf ist gespeichert, wurde aber nicht zur Prüfung eingereicht. Reiche ihn hier noch einmal ein.',
      );
  };
}

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
  const showSentDraft = useSentDraft(editor, newArtifactId);

  /** The save over the network; `no_answer` when the request never returned and the device keeps the draft. */
  async function saveOnServer(submit: boolean, fromDraft: { revisionId: string; changedAt: string } | null) {
    try {
      return await saveWorkArtifact({
        artifactId: detail?.id ?? newArtifactId,
        // A draft on the device lends its revision id: when this answer is lost, the device's
        // send of the same draft is the same write, and the server replays it.
        revisionId: fromDraft?.revisionId ?? crypto.randomUUID(),
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
        // The sealed draft's state: the server adopts this revision for that draft's send only then.
        ...(fromDraft ? { draftChangedAt: fromDraft.changedAt } : {}),
      });
    } catch (error) {
      // Only a draft on the device has somewhere to wait for the signal.
      if (fromDraft === null) throw error;
      return 'no_answer' as const;
    }
  }

  async function runSave(submit: boolean): Promise<void> {
    const onDevice = deviceDraft.current;
    const draft = onDevice ? await onDevice.committed() : null;
    // The device could not say whether the draft has photos: a text-only save could lose them.
    if (onDevice && draft === null) return;
    // Photos reach the server only with the draft the device holds. A draft without photos is sealed
    // before its online save leaves: if that save lands and its answer is lost, nothing changes the
    // draft until the device's send of the same revision is answered.
    const changedAt = onDevice && draft && draft.photoCount === 0 ? await onDevice.seal() : null;
    if (draft && draft.photoCount === 0 && changedAt === null) return;
    const result =
      draft && draft.photoCount > 0
        ? 'no_answer'
        : await saveOnServer(submit, draft && changedAt ? { revisionId: draft.revisionId, changedAt } : null);
    if (result === 'no_answer') {
      const sent = (await onDevice?.save(submit)) ?? null;
      if (sent) await showSentDraft(submit, sent);
      return;
    }
    if (!result.success) {
      // The server refused the save and holds nothing of it: the draft can change again.
      await onDevice?.unseal();
      await editor.handleMutationFailure(
        result,
        'Der Arbeitsnachweis konnte nicht gespeichert werden.',
        false,
      );
      return;
    }
    // The server holds it now: the copy on the device goes. A refused delete never rejects (the keeper
    // shows it); the kept copy's later send carries this revision id, and the server replays it.
    await onDevice?.discard();
    // The save returns the stored detail; only a failed read after the write needs a second round trip.
    if (result.artifact) editor.applyDetail(result.artifact);
    else await editor.load(result.artifactId);
    editor.setEditing(false);
    editor.setAttemptedSave(null);
    editor.setCorrectionReason('');
    showBanner({ variant: 'success', message: submit ? SUBMITTED_MESSAGE : SAVED_MESSAGE });
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
