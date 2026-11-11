'use client';

import { useBanner } from '@/components/ui/banner';
import { focusFirstInvalidField, REASON_MIN_3_MESSAGE } from '@/lib/ui/field-validation';
import { recordWorkArtifactAction, saveWorkArtifact } from '@/lib/work-artifacts/actions';
import { workArtifactFieldIssues } from '@/lib/work-artifacts/field-rules';
import type { WorkArtifactEditor } from './use-work-artifact-editor';
import type { WorkArtifactDeviceDraft } from './use-work-artifact-device-draft';
import type { WorkArtifactTarget } from '@/lib/work-artifacts/types';
import { contentForKind, iso, savedContent } from './work-artifact-content';
import { workArtifactFieldErrors } from './work-artifact-field-errors';

type WorkArtifactSaveOptions = WorkArtifactTarget & {
  editor: WorkArtifactEditor;
  /** The id a new Arbeitsnachweis gets, shared with its draft on the device. */
  newArtifactId: string;
  deviceDraft: WorkArtifactDeviceDraft;
  onClose: () => void;
};

const SAVED_MESSAGE = 'Arbeitsnachweis wurde gespeichert.';
const SUBMITTED_MESSAGE = 'Arbeitsnachweis wurde zur Prüfung eingereicht.';

/** What a draft that did not reach the server says at the form; a failed device write shows its own sentence. */
const DEVICE_REFUSALS: Record<'no_access' | 'refused' | 'skipped', string> = {
  no_access:
    'Du hast keinen Zugriff mehr auf diesen Auftrag. Der Entwurf bleibt auf diesem Gerät, wird aber nicht übertragen.',
  refused: 'Der Entwurf konnte nicht übertragen werden. Er bleibt auf diesem Gerät gespeichert.',
  skipped: 'Der Entwurf konnte nicht übertragen werden. Er bleibt auf diesem Gerät gespeichert.',
};

/** Asks for the review of the revision a sent draft wrote. False when the request failed or got no answer. */
async function requestReview(artifactId: string, sent: { revisionId: string; version: number }) {
  try {
    const review = await recordWorkArtifactAction({
      artifactId,
      revisionId: sent.revisionId,
      actionId: crypto.randomUUID(),
      expectedVersion: sent.version,
      actionType: 'review_requested',
    });
    return review.success;
  } catch {
    return false;
  }
}

/**
 * Sends the draft the device holds, with its photos, as one draft revision. A submit asks for the
 * review once the server holds that revision: nothing is submitted without signal.
 */
function useDeviceDraftSave({
  editor,
  newArtifactId,
  deviceDraft,
  onClose,
}: Pick<WorkArtifactSaveOptions, 'editor' | 'newArtifactId' | 'deviceDraft' | 'onClose'>) {
  const { setAttemptedSave, setEditing, setError, load } = editor;
  const { showBanner } = useBanner();
  return async function saveThroughDevice(submit: boolean): Promise<void> {
    const sent = await deviceDraft.send();
    if (sent.outcome === 'waiting') {
      onClose();
      showBanner({
        variant: 'info',
        message: submit
          ? 'Gerade kein Netz. Der Entwurf ist auf diesem Gerät gespeichert und wird später übertragen. Reiche ihn danach zur Prüfung ein.'
          : 'Gerade kein Netz. Der Entwurf ist auf diesem Gerät gespeichert und wird später übertragen.',
      });
      return;
    }
    if (sent.outcome !== 'sent') {
      if (sent.outcome !== 'not_stored') setError(DEVICE_REFUSALS[sent.outcome]);
      return;
    }
    const submitted = submit ? await requestReview(newArtifactId, sent) : true;
    await load(newArtifactId);
    setEditing(false);
    setAttemptedSave(null);
    if (!submitted) {
      setError(
        'Der Entwurf ist gespeichert, wurde aber nicht zur Prüfung eingereicht. Reiche ihn hier noch einmal ein.',
      );
      return;
    }
    showBanner({ variant: 'success', message: submit ? SUBMITTED_MESSAGE : SAVED_MESSAGE });
  };
}

/**
 * Saves the draft as a new revision, optionally submitting it for review. A new Arbeitsnachweis
 * of a job with photos, or one whose save got no answer, goes through its draft on the device.
 */
export function useWorkArtifactSave(options: WorkArtifactSaveOptions): (submit: boolean) => void {
  const { targetType, targetId, editor, newArtifactId, deviceDraft } = options;
  const { detail, currentRevision, requiresCorrectionReason, kind, title, content, correctionReason } =
    editor;
  const { showBanner } = useBanner();
  const saveThroughDevice = useDeviceDraftSave(options);

  /** The save over the network; `no_answer` when the request never returned, as without signal. */
  async function saveOnServer(submit: boolean) {
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
      // Only a new Arbeitsnachweis with a draft on the device has somewhere to wait for the signal.
      if (!deviceDraft.active) throw error;
      return 'no_answer' as const;
    }
  }

  async function runSave(submit: boolean): Promise<void> {
    // Photos reach the server only with the draft the device holds.
    const result =
      deviceDraft.active && deviceDraft.photos.length > 0 ? 'no_answer' : await saveOnServer(submit);
    if (result === 'no_answer') {
      await saveThroughDevice(submit);
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
    if (deviceDraft.active) await deviceDraft.discard();
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
