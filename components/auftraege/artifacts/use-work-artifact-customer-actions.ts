'use client';

import { useState } from 'react';

import { useBanner } from '@/components/ui/banner';
import type { DocumentUploadTarget } from '@/lib/documents/types';
import { uploadWorkArtifactSignatureDirect } from '@/lib/documents/upload-client';
import { focusFirstInvalidField, REASON_MIN_3_MESSAGE } from '@/lib/ui/field-validation';
import { discardUnlinkedWorkArtifactSignature } from '@/lib/work-artifacts/actions';
import { recordWorkArtifactCustomerDecision } from '@/lib/work-artifacts/customer-decision-actions';
import {
  customerDecisionNeedsReason,
  recordedCustomerDecision,
  type CustomerDecisionType,
} from '@/lib/work-artifacts/customer-decision';
import type { WorkArtifactTarget } from '@/lib/work-artifacts/types';
import type { WorkArtifactEditor } from './use-work-artifact-editor';

/** The control ids of the decision form, in their order on the screen. */
export const CUSTOMER_DECISION_FIELD_IDS = {
  name: 'artifact-customer-name',
  role: 'artifact-customer-role',
  relationship: 'artifact-customer-relationship',
  decision: 'artifact-customer-decision',
  reason: 'artifact-customer-reason',
} as const;

const DEFAULT_RELATIONSHIP = 'Ansprechperson vor Ort';

type WorkArtifactCustomerActionsOptions = WorkArtifactTarget & {
  editor: WorkArtifactEditor;
  onClose: () => void;
};

function signatureUploadTarget({ targetType, targetId }: WorkArtifactTarget): DocumentUploadTarget {
  return targetType === 'job' ? { kind: 'job', jobId: targetId } : { kind: 'project', projectId: targetId };
}

type ShowBanner = ReturnType<typeof useBanner>['showBanner'];

/** Uploads the signature image and returns its document id, or null when the upload failed. */
async function uploadSignature(
  file: File,
  artifactId: string,
  target: WorkArtifactTarget,
): Promise<string | null> {
  const uploaded = await uploadWorkArtifactSignatureDirect({
    file,
    artifactId,
    target: signatureUploadTarget(target),
  });
  return uploaded.success ? uploaded.document.id : null;
}

/** Discards a signature upload no action links; a failure leaves it in the library and says so. */
async function discardPendingSignature(documentId: string, showBanner: ShowBanner): Promise<void> {
  const discarded = await discardUnlinkedWorkArtifactSignature(documentId).catch(() => ({
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
}

type CustomerDecisionErrors = Record<'name' | 'relationship' | 'decision' | 'reason', string | undefined>;

/** Each field's message for the entries as they are; undefined where a field is fine. */
function customerDecisionErrors(
  customerName: string,
  customerRelationship: string,
  decision: CustomerDecisionType | null,
  decisionReason: string,
): CustomerDecisionErrors {
  return {
    name: customerName.trim().length >= 2 ? undefined : 'Bitte gib den Namen der Kundin oder des Kunden an.',
    relationship: customerRelationship.trim()
      ? undefined
      : 'Bitte gib an, in welchem Bezug die Person zum Kunden steht.',
    decision: decision ? undefined : 'Bitte wähle die Entscheidung der Kundin oder des Kunden.',
    reason:
      decision && customerDecisionNeedsReason(decision) && decisionReason.trim().length < 3
        ? REASON_MIN_3_MESSAGE
        : undefined,
  };
}

/** The form's entries and, after a save attempt, their field errors as the user edits. */
function useCustomerDecisionDraft() {
  const [customerName, setCustomerName] = useState('');
  const [customerRole, setCustomerRole] = useState('');
  const [customerRelationship, setCustomerRelationship] = useState(DEFAULT_RELATIONSHIP);
  const [decision, setDecision] = useState<CustomerDecisionType | null>(null);
  const [decisionReason, setDecisionReason] = useState('');
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  const [attemptedSave, setAttemptedSave] = useState(false);
  const current = customerDecisionErrors(customerName, customerRelationship, decision, decisionReason);
  const errors: Partial<CustomerDecisionErrors> = attemptedSave ? current : {};

  /** Marks the broken fields and focuses the first; true when the form can be saved. */
  function validate(): boolean {
    setAttemptedSave(true);
    return !focusFirstInvalidField({
      [CUSTOMER_DECISION_FIELD_IDS.name]: current.name,
      [CUSTOMER_DECISION_FIELD_IDS.relationship]: current.relationship,
      [CUSTOMER_DECISION_FIELD_IDS.decision]: current.decision,
      [CUSTOMER_DECISION_FIELD_IDS.reason]: current.reason,
    });
  }

  function reset() {
    setCustomerName('');
    setCustomerRole('');
    setCustomerRelationship(DEFAULT_RELATIONSHIP);
    setDecision(null);
    setDecisionReason('');
    setSignatureFile(null);
    setAttemptedSave(false);
  }

  return {
    customerName,
    setCustomerName,
    customerRole,
    setCustomerRole,
    customerRelationship,
    setCustomerRelationship,
    decision,
    setDecision,
    decisionReason,
    setDecisionReason,
    signatureFile,
    setSignatureFile,
    errors,
    validate,
    reset,
  };
}

/**
 * The answers that do not say whether the save stood: an unknown database
 * error, a reply that failed to read after a commit, or a failure around the
 * action. Like a lost answer, they leave the outcome to a retry.
 */
const OUTCOME_UNKNOWN_ERRORS: ReadonlySet<string> = new Set([
  'work_artifact_action_failed',
  'unexpected_error',
]);

type CustomerDecisionDraft = ReturnType<typeof useCustomerDecisionDraft>;

/** The save's input: the decision, its signer and, when uploaded, the signature, under the attempt's action ids. */
function customerDecisionRequest(input: {
  artifactId: string;
  revisionId: string;
  expectedVersion: number;
  decision: CustomerDecisionType;
  draft: CustomerDecisionDraft;
  actionIds: { decision: string; signature: string };
  signatureDocumentId: string | null;
}): Parameters<typeof recordWorkArtifactCustomerDecision>[0] {
  const { decision, draft, actionIds, signatureDocumentId } = input;
  return {
    artifactId: input.artifactId,
    revisionId: input.revisionId,
    expectedVersion: input.expectedVersion,
    decisionActionId: actionIds.decision,
    decision,
    ...(customerDecisionNeedsReason(decision) ? { reason: draft.decisionReason } : {}),
    signer: {
      name: draft.customerName,
      ...(draft.customerRole.trim() ? { role: draft.customerRole } : {}),
      relationship: draft.customerRelationship,
    },
    ...(signatureDocumentId
      ? { signature: { actionId: actionIds.signature, documentId: signatureDocumentId } }
      : {}),
  };
}

/**
 * The customer's decision with its optional signature in one save, the
 * recorded decision of the current revision, and the close flow that discards
 * a signature upload no save used.
 */
export function useWorkArtifactCustomerActions({
  targetType,
  targetId,
  editor,
  onClose,
}: WorkArtifactCustomerActionsOptions) {
  const { detail, currentRevision, load, handleMutationFailure, runArtifactTask, setError } = editor;
  const { showBanner } = useBanner();
  const draft = useCustomerDecisionDraft();
  const [pendingSignatureDocumentId, setPendingSignatureDocumentId] = useState<string | null>(null);
  // The action ids of the save under way: a retry after a lost answer sends
  // them again, so the server returns what it recorded instead of refusing a
  // second decision. A save or a close starts the next attempt fresh.
  const [pendingActionIds, setPendingActionIds] = useState<{ decision: string; signature: string } | null>(
    null,
  );
  // A save whose answer was lost may have been recorded. The replay of its ids
  // returns the first entries without comparing, so the form locks its entries
  // until a save succeeds or the dialog closes. A refusal settles nothing: a
  // sign-in or input check can refuse before the server compares the ids.
  const [outcomeUnknown, setOutcomeUnknown] = useState(false);
  const recorded = detail && currentRevision ? recordedCustomerDecision(detail, currentRevision.id) : null;

  function saveDecision() {
    if (!detail || !currentRevision || !draft.validate() || !draft.decision) return;
    const decision = draft.decision;
    const actionIds = pendingActionIds ?? { decision: crypto.randomUUID(), signature: crypto.randomUUID() };
    setPendingActionIds(actionIds);
    setError(null);
    void runArtifactTask('customer-decision', async () => {
      let signatureDocumentId = pendingSignatureDocumentId;
      if (draft.signatureFile && !signatureDocumentId && !recorded?.signature) {
        signatureDocumentId = await uploadSignature(draft.signatureFile, detail.id, { targetType, targetId });
        if (signatureDocumentId === null) {
          setError('Die Unterschrift konnte nicht hochgeladen werden. Bitte versuche es erneut.');
          return;
        }
        setPendingSignatureDocumentId(signatureDocumentId);
      }
      const result = await recordWorkArtifactCustomerDecision(
        customerDecisionRequest({
          artifactId: detail.id,
          revisionId: currentRevision.id,
          expectedVersion: detail.version,
          decision,
          draft,
          actionIds,
          signatureDocumentId,
        }),
      ).catch(() => null);
      if (result === null || (!result.success && OUTCOME_UNKNOWN_ERRORS.has(result.error))) {
        setOutcomeUnknown(true);
        setError(
          'Die Antwort zum Speichern ist nicht angekommen. Speichere erneut, um zu prüfen, was erfasst wurde.',
        );
        return;
      }
      if (!result.success && result.error === 'work_artifact_customer_decision_recorded') {
        // Someone recorded the decision meanwhile: the reload shows it in place of the form.
        await load(detail.id);
        setError('Für diese Version ist bereits eine Kundenentscheidung erfasst. Sie wird jetzt angezeigt.');
        return;
      }
      if (await handleMutationFailure(result, 'Die Kundenentscheidung konnte nicht gespeichert werden.'))
        return;
      await load(detail.id);
      draft.reset();
      setOutcomeUnknown(false);
      setPendingSignatureDocumentId(null);
      setPendingActionIds(null);
      showBanner({ variant: 'success', message: 'Kundenentscheidung wurde gespeichert.' });
    });
  }

  async function closeDialog() {
    const signatureInUse = detail?.actions.some(
      (action) => action.signature_document_id === pendingSignatureDocumentId,
    );
    if (pendingSignatureDocumentId && !signatureInUse) {
      await discardPendingSignature(pendingSignatureDocumentId, showBanner);
    }
    setPendingSignatureDocumentId(null);
    setPendingActionIds(null);
    setOutcomeUnknown(false);
    onClose();
  }

  const requestClose = () => void runArtifactTask('close', closeDialog);

  return { ...draft, recorded, pendingSignatureDocumentId, outcomeUnknown, saveDecision, requestClose };
}

export type WorkArtifactCustomerActions = ReturnType<typeof useWorkArtifactCustomerActions>;
