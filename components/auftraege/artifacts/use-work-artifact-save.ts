'use client';

import { useRef } from 'react';

import { useBanner } from '@/components/ui/banner';
import { focusFirstInvalidField, REASON_MIN_3_MESSAGE } from '@/lib/ui/field-validation';
import { saveWorkArtifact } from '@/lib/work-artifacts/actions';
import { workArtifactFieldIssues } from '@/lib/work-artifacts/field-rules';
import type { WorkArtifactEditor } from './use-work-artifact-editor';
import type { WorkArtifactTarget } from '@/lib/work-artifacts/types';
import { compact, contentForKind, iso } from './work-artifact-content';
import { workArtifactFieldErrors } from './work-artifact-field-errors';

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
    setAttemptedSave,
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
    const draftContent = contentForKind(kind, content);
    // The save schema's own field rules mark and focus the fields before the request.
    const issues = workArtifactFieldIssues({ kind, title, submit, content: draftContent });
    const reasonError =
      requiresCorrectionReason && correctionReason.trim().length < 3 ? REASON_MIN_3_MESSAGE : undefined;
    setAttemptedSave({ submit });
    setCorrectionReasonError(reasonError ?? null);
    const errors = { ...workArtifactFieldErrors(issues), 'artifact-correction-reason': reasonError };
    if (focusFirstInvalidField(errors)) return;
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
          ...draftContent,
          visitStartedAt: iso(draftContent.visitStartedAt ?? ''),
          visitEndedAt: iso(draftContent.visitEndedAt ?? ''),
          nextVisitAt: iso(draftContent.nextVisitAt ?? ''),
        }),
        ...(requiresCorrectionReason && currentRevision ? { correctsRevisionId: currentRevision.id } : {}),
        ...(requiresCorrectionReason ? { correctionReason } : {}),
        submit,
        ...(submit ? { submitActionId: crypto.randomUUID() } : {}),
      });
      if (!result.success) {
        await handleMutationFailure(result, 'Der Arbeitsnachweis konnte nicht gespeichert werden.', false);
        return;
      }
      // The save returns the stored detail; only a failed read after the write needs a second round trip.
      if (result.artifact) applyDetail(result.artifact);
      else await load(result.artifactId);
      setEditing(false);
      setAttemptedSave(null);
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
