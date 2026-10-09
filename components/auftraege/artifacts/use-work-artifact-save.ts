'use client';

import { useRef } from 'react';

import { useBanner } from '@/components/ui/banner';
import { focusFirstInvalidField, REASON_MIN_3_MESSAGE } from '@/lib/ui/field-validation';
import { saveWorkArtifact } from '@/lib/work-artifacts/actions';
import type { WorkArtifactEditor } from './use-work-artifact-editor';
import { compact, iso, type WorkArtifactTarget } from './work-artifact-content';

/** Saves the draft as a new revision, optionally submitting it for review. */
export function useWorkArtifactSave({
  targetType,
  targetId,
  editor,
}: WorkArtifactTarget & { editor: WorkArtifactEditor }): (submit: boolean) => void {
  const {
    detail,
    currentRevision,
    requiresCorrectionReason,
    kind,
    visibility,
    capturedAt,
    title,
    content,
    correctionReason,
    setCorrectionReason,
    setCorrectionReasonError,
    setEditing,
    setError,
    load,
    applyDetail,
    handleMutationFailure,
    runArtifactTask,
  } = editor;
  const { showBanner } = useBanner();
  const draftArtifactIdRef = useRef(crypto.randomUUID());

  function save(submit: boolean) {
    const reasonError =
      requiresCorrectionReason && correctionReason.trim().length < 3 ? REASON_MIN_3_MESSAGE : undefined;
    setCorrectionReasonError(reasonError ?? null);
    if (focusFirstInvalidField({ 'artifact-correction-reason': reasonError })) return;
    setError(null);
    void runArtifactTask(submit ? 'submit' : 'draft', async () => {
      const id = detail?.id ?? draftArtifactIdRef.current;
      const result = await saveWorkArtifact({
        artifactId: id,
        revisionId: crypto.randomUUID(),
        expectedVersion: detail?.version ?? null,
        targetType,
        targetId,
        kind,
        visibility,
        capturedAt: iso(capturedAt) ?? new Date().toISOString(),
        title,
        content: compact({
          ...content,
          visitStartedAt: iso(content.visitStartedAt ?? ''),
          visitEndedAt: iso(content.visitEndedAt ?? ''),
          nextVisitAt: iso(content.nextVisitAt ?? ''),
        }),
        ...(requiresCorrectionReason && currentRevision ? { correctsRevisionId: currentRevision.id } : {}),
        ...(requiresCorrectionReason ? { correctionReason } : {}),
        submit,
        ...(submit ? { submitActionId: crypto.randomUUID() } : {}),
      });
      if (!result.success) {
        if (result.error === 'invalid_input')
          setError('Bitte fülle die Pflichtangaben der gewählten Art aus.');
        else
          await handleMutationFailure(result, 'Der Arbeitsnachweis konnte nicht gespeichert werden.', false);
        return;
      }
      // The save returns the stored detail; only a failed read after the write needs a second round trip.
      if (result.artifact) applyDetail(result.artifact);
      else await load(result.artifactId);
      setEditing(false);
      setCorrectionReason('');
      showBanner({
        variant: 'success',
        message: submit
          ? 'Arbeitsnachweis wurde zur Prüfung eingereicht.'
          : 'Arbeitsnachweis wurde gespeichert.',
      });
    });
  }

  return save;
}
