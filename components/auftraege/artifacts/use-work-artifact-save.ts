'use client';

import type { RefObject } from 'react';

import { useBanner } from '@/components/ui/banner';
import { focusFirstInvalidField, REASON_MIN_3_MESSAGE } from '@/lib/ui/field-validation';
import { recordWorkArtifactAction, saveWorkArtifact } from '@/lib/work-artifacts/actions';
import { workArtifactFieldIssues } from '@/lib/work-artifacts/field-rules';
import { DRAFT_SEND_BUSY, whileNoDraftSend } from '@/lib/field-sync/device/draft-sync';
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
const SEALED_ELSEWHERE_MESSAGE =
  'Dieser Entwurf wird gerade aus einem anderen Fenster gesendet. Deine Änderungen hier sind noch nicht gespeichert und bleiben im Formular.';
const TRANSFER_RUNNING_MESSAGE =
  'Der Entwurf konnte gerade nicht gespeichert werden, weil noch eine Übertragung läuft. Deine Eingaben bleiben im Formular. Versuch es gleich noch einmal.';

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

type DraftSavePlan = Awaited<ReturnType<DeviceDraftHandle['prepareSave']>>;
/** What the server answers a save of an Arbeitsnachweis. */
type ServerSave = Awaited<ReturnType<typeof saveWorkArtifact>>;

/**
 * The draft's save through the device, in the drafts' send turn from its seal to its cleanup: a
 * session end's discard in any tab waits for all of it, and can never fall between the seal and the
 * online save (decision record 0010, the amendment "report drafts at a session end after review").
 * Only a sealed text-only draft saves online here; every other plan answers `no_answer`, and its
 * device send runs after the turn, which it takes itself. A refusal unseals the draft, which the
 * server holds nothing of; `keptForm` when another tab changed it meanwhile. A success removes the
 * device's copy: a refused delete never rejects (the keeper shows it), and the kept copy's later
 * send carries this revision id, which the server replays. DRAFT_SEND_BUSY when another send held
 * the turn past its bound: then nothing was sealed or saved, and nothing of this save runs later.
 */
function saveThroughDevice(
  onDevice: DeviceDraftHandle,
  save: (fromDraft: { revisionId: string; changedAt: string }) => Promise<ServerSave | 'no_answer'>,
): Promise<
  { plan: DraftSavePlan; result: ServerSave | 'no_answer'; keptForm: boolean } | typeof DRAFT_SEND_BUSY
> {
  return whileNoDraftSend(async () => {
    const plan = await onDevice.prepareSave();
    if (plan?.kind !== 'online') return { plan, result: 'no_answer', keptForm: false };
    const result = await save(plan);
    if (result === 'no_answer') return { plan, result, keptForm: false };
    if (!result.success) return { plan, result, keptForm: !(await onDevice.unseal(plan.changedAt)) };
    await onDevice.discard();
    return { plan, result, keptForm: false };
  });
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
    // Photos reach the server only with the draft the device holds. A draft without photos is sealed
    // for its online save: if it lands and the answer is lost, nothing changes the draft until the
    // device's send of the same revision is answered.
    const saved = onDevice
      ? await saveThroughDevice(onDevice, (fromDraft) => saveOnServer(submit, fromDraft))
      : { plan: null, result: await saveOnServer(submit, null), keptForm: false };
    // A send in a dead spot holds the drafts' turn: nothing was saved, and the form keeps its text.
    if (saved === DRAFT_SEND_BUSY) return editor.setError(TRANSFER_RUNNING_MESSAGE);
    const { plan, result, keptForm } = saved;
    // The device could not say whether the draft has photos: a text-only save could lose them.
    if (onDevice && plan === null) return;
    // Another tab's save is on its way with the draft as it was: this form keeps what changed since.
    if (plan?.kind === 'sealed_elsewhere')
      return void showBanner({ variant: 'error', message: SEALED_ELSEWHERE_MESSAGE });
    if (result === 'no_answer') {
      // The device sends the draft in the state this save decided on, or keeps the form when it changed.
      const sent = plan && onDevice ? await onDevice.save(submit, plan.changedAt) : null;
      if (sent) await showSentDraft(submit, sent);
      return;
    }
    if (!result.success) {
      // Another tab changed the draft while the seal held it: the keeper said so and the form keeps its text.
      if (keptForm) return;
      await editor.handleMutationFailure(
        result,
        'Der Arbeitsnachweis konnte nicht gespeichert werden.',
        false,
      );
      return;
    }
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
