'use client';

import { useState } from 'react';

import { useBanner } from '@/components/ui/banner';
import {
  exportWorkArtifact,
  fulfillInstructionEvidence,
  linkWorkArtifactDocument,
  linkWorkArtifactSource,
  removeInstructionEvidenceFulfillment,
} from '@/lib/work-artifacts/actions';
import type { WorkArtifactTimeSourceOption } from '@/lib/work-artifacts/types';
import type { WorkArtifactEditor } from './use-work-artifact-editor';
import type { WorkArtifactReviewActions } from './use-work-artifact-review-actions';
import type { WorkArtifactEvidenceRequirement } from './work-artifact-content';

type WorkArtifactLinksOptions = {
  editor: WorkArtifactEditor;
  review: WorkArtifactReviewActions;
  timeEntryOptions: WorkArtifactTimeSourceOption[];
};

/** Document, time-entry and evidence links of the current revision, and its export. */
export function useWorkArtifactLinks({ editor, review, timeEntryOptions }: WorkArtifactLinksOptions) {
  const { detail, currentRevision, load, handleMutationFailure, runArtifactTask, setError } = editor;
  const { actionReason, setActionReason, hasActionReason } = review;
  const { showBanner } = useBanner();
  const [documentId, setDocumentId] = useState('');
  const [documentRelation, setDocumentRelation] = useState<'supporting_evidence' | 'closure_proof'>(
    'supporting_evidence',
  );
  const [timeSourceId, setTimeSourceId] = useState('');
  // "Verknüpfen" stays enabled; a click without a choice marks the select instead.
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [timeSourceError, setTimeSourceError] = useState<string | null>(null);
  const [localFulfillments, setLocalFulfillments] = useState(
    () => new Map<string, { id: string; version: number }>(),
  );
  const [removedFulfillmentIds, setRemovedFulfillmentIds] = useState(() => new Set<string>());

  function selectDocument(value: string) {
    setDocumentId(value);
    setDocumentError(null);
  }

  function selectTimeSource(value: string) {
    setTimeSourceId(value);
    setTimeSourceError(null);
  }

  function linkDocument() {
    if (!detail || !currentRevision) return;
    if (!documentId) {
      setDocumentError('Bitte wähle ein Dokument aus.');
      document.getElementById('artifact-link-document')?.focus();
      return;
    }
    void runArtifactTask('document', async () => {
      const result = await linkWorkArtifactDocument({
        artifactId: detail.id,
        revisionId: currentRevision.id,
        linkId: crypto.randomUUID(),
        expectedVersion: detail.version,
        documentId,
        relation: documentRelation,
      });
      if (await handleMutationFailure(result, 'Das Dokument konnte nicht verknüpft werden.')) return;
      await load(detail.id);
      setDocumentId('');
      showBanner({ variant: 'success', message: 'Dokument wurde verknüpft.' });
    });
  }

  function exportArtifact() {
    if (!detail) return;
    void runArtifactTask('export', async () => {
      const result = await exportWorkArtifact({
        artifactId: detail.id,
        expectedVersion: detail.version,
        linkId: crypto.randomUUID(),
        actionId: crypto.randomUUID(),
        documentId: crypto.randomUUID(),
      });
      if (await handleMutationFailure(result, 'Der Export konnte nicht erstellt werden.')) return;
      await load(detail.id);
      showBanner({ variant: 'success', message: 'HTML-Export wurde unter Dokumente abgelegt.' });
    });
  }

  function linkTimeEntry() {
    if (!detail || !currentRevision) return;
    if (!timeSourceId) {
      setTimeSourceError('Bitte wähle einen Zeiteintrag aus.');
      document.getElementById('artifact-link-time-source')?.focus();
      return;
    }
    const selectedTimeSource = timeEntryOptions.find((option) => option.id === timeSourceId);
    if (!selectedTimeSource) return;
    void runArtifactTask('time', async () => {
      const result = await linkWorkArtifactSource({
        artifactId: detail.id,
        revisionId: currentRevision.id,
        linkId: crypto.randomUUID(),
        expectedVersion: detail.version,
        ...(selectedTimeSource.sourceType === 'time_segment'
          ? { timeSegmentId: selectedTimeSource.id }
          : { timeEntryId: selectedTimeSource.id }),
        description: 'Arbeitszeitbezug',
      });
      if (await handleMutationFailure(result, 'Der Zeiteintrag konnte nicht verknüpft werden.')) return;
      await load(detail.id);
      setTimeSourceId('');
      showBanner({ variant: 'success', message: 'Zeiteintrag wurde mit dieser Version verknüpft.' });
    });
  }

  function fulfill(requirementId: string) {
    if (!currentRevision) return;
    setError(null);
    void runArtifactTask(`evidence:${requirementId}`, async () => {
      const fulfillmentId = crypto.randomUUID();
      const result = await fulfillInstructionEvidence({
        fulfillmentId,
        evidenceRequirementId: requirementId,
        artifactRevisionId: currentRevision.id,
      });
      if (!result.success) {
        setError('Die Nachweiserwartung konnte nicht erfüllt werden.');
        return;
      }
      setLocalFulfillments((current) =>
        new Map(current).set(requirementId, { id: fulfillmentId, version: 1 }),
      );
      setRemovedFulfillmentIds((current) => {
        const next = new Set(current);
        next.delete(requirementId);
        return next;
      });
      showBanner({ variant: 'success', message: 'Nachweiserwartung wurde mit dieser Version erfüllt.' });
    });
  }

  function removeFulfillment(
    requirement: WorkArtifactEvidenceRequirement,
    fulfillment: { id: string; version: number },
  ) {
    if (!hasActionReason()) return;
    setError(null);
    void runArtifactTask(`evidence:${requirement.id}`, async () => {
      const result = await removeInstructionEvidenceFulfillment({
        fulfillmentId: fulfillment.id,
        expectedVersion: fulfillment.version,
        reason: actionReason,
      });
      if (!result.success) {
        setError('Die Nachweiserfüllung konnte nicht entfernt werden.');
        return;
      }
      setRemovedFulfillmentIds((current) => new Set(current).add(requirement.id));
      setLocalFulfillments((current) => {
        const next = new Map(current);
        next.delete(requirement.id);
        return next;
      });
      setActionReason('');
      showBanner({ variant: 'success', message: 'Nachweiserfüllung wurde begründet entfernt.' });
    });
  }

  return {
    documentId,
    selectDocument,
    documentError,
    documentRelation,
    setDocumentRelation,
    timeSourceId,
    selectTimeSource,
    timeSourceError,
    localFulfillments,
    removedFulfillmentIds,
    linkDocument,
    exportArtifact,
    linkTimeEntry,
    fulfill,
    removeFulfillment,
  };
}

export type WorkArtifactLinks = ReturnType<typeof useWorkArtifactLinks>;
