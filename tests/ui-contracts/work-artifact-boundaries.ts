// Isolated stand-in for `@/lib/work-artifacts/actions`: a save records its
// input and answers with the saved work report as the server would read it.
// Every other artifact action is a contract violation.
import type {
  RecordedVisitWindow,
  SaveWorkArtifactInput,
  WorkArtifactActionRow,
  WorkArtifactDetail,
} from '@/lib/work-artifacts/types';
import { contractDocument } from './document-upload-boundaries';
import { unexpectedWrite } from './held-write-boundary';

type WorkArtifactActions = typeof import('@/lib/work-artifacts/actions');
type CustomerDecisionActions = typeof import('@/lib/work-artifacts/customer-decision-actions');
type CustomerDecisionInput = Parameters<CustomerDecisionActions['recordWorkArtifactCustomerDecision']>[0];
type UploadClient = typeof import('@/lib/documents/upload-client');

declare global {
  interface Window {
    uiContractWorkArtifacts: {
      saves: SaveWorkArtifactInput[];
      detail: WorkArtifactDetail | null;
      /** Each customer-decision save, as the server action received it. */
      decisions: CustomerDecisionInput[];
      /** The file names of the signature uploads. */
      signatureUploads: string[];
      /** The signature uploads a close discarded. */
      discards: string[];
      /** Set by a spec: a save gets no answer, as without signal. */
      loseSaveAnswer?: boolean;
      /** Set by a spec: the code the next decision save is refused with. */
      refuseDecision?: string;
      /** Set by a spec: the next decision save is recorded, but its answer is lost. */
      loseDecisionAnswer?: boolean;
      /** Set by a spec: the signature image's view URL cannot be read. */
      failSignatureView?: boolean;
      /** Set by a spec: the view URL reads, but the image behind it does not load. */
      brokenSignatureImage?: boolean;
    };
    /** Set by a spec's init script: the visit window the page read from today's time records. */
    uiContractRecordedVisit?: RecordedVisitWindow;
    /** Set by a spec's init script: a coworker recorded the decision and signature, redacted for this viewer. */
    uiContractRedactedDecision?: boolean;
    /** Set by a spec's init script: an earlier release saved the customer's signature alone, without a decision. */
    uiContractLegacySignature?: boolean;
    /** Set by a spec's init script: an earlier release saved the decision and the signature apart, by two people. */
    uiContractSplitSigners?: boolean;
    /** Set by a spec's init script: canvas conversions held until the spec releases them. */
    uiContractHeldCanvasConversions?: Array<() => void>;
    /** Set by a spec's init script: who opens the customer-decision fixture; the field worker by default. */
    uiContractWorkArtifactViewer?: 'employee' | 'admin';
  }
}

window.uiContractWorkArtifacts = {
  saves: [],
  detail: null,
  decisions: [],
  signatureUploads: [],
  discards: [],
};

const actor = 'contract-worker';

function savedDetail(input: SaveWorkArtifactInput): WorkArtifactDetail {
  const at = new Date().toISOString();
  const content = input.content;
  return {
    id: input.artifactId,
    organization_id: 'contract-organization',
    job_id: input.targetId,
    project_id: null,
    kind: input.kind,
    status: input.submit ? 'submitted' : 'draft',
    version: 1,
    current_revision_id: input.revisionId,
    created_at: at,
    created_by: actor,
    updated_at: at,
    void_reason: null,
    voided_at: null,
    voided_by: null,
    revisions: [
      {
        id: input.revisionId,
        artifact_id: input.artifactId,
        organization_id: 'contract-organization',
        kind: input.kind,
        revision_number: 1,
        title: input.title,
        visibility: input.visibility,
        captured_at: input.capturedAt,
        created_at: at,
        created_by: actor,
        correction_reason: null,
        corrects_revision_id: null,
        summary: content.summary ?? null,
        performed_work: content.performedWork ?? null,
        visit_started_at: content.visitStartedAt ?? null,
        visit_ended_at: content.visitEndedAt ?? null,
        next_visit_at: null,
        outstanding_work: null,
        materials_summary: null,
        customer_statement: null,
        requires_customer_response: false,
        requires_signature: false,
        instruction_item_id: null,
        site_id: null,
        work_date: null,
        progress: null,
        people_present: null,
        weather_conditions: null,
        site_conditions: null,
        deliveries: null,
        impediments: null,
        decisions: null,
        notable_events: null,
        measurement_date: null,
        measurement_location: null,
        measurement_notes: null,
      },
    ],
    actions: input.submit
      ? [
          {
            id: input.submitActionId ?? 'contract-submit',
            artifact_id: input.artifactId,
            revision_id: input.revisionId,
            organization_id: 'contract-organization',
            action_type: 'review_requested',
            created_at: at,
            created_by: actor,
            reason: null,
            comment: null,
            capture_method: null,
            responsibility_snapshot: null,
            signature_document_id: null,
            signer_company_context: null,
            signer_name: null,
            signer_relationship: null,
            signer_role: null,
            witness_context: null,
            wording_snapshot: null,
          },
        ]
      : [],
    measurementLines: [],
    defectDetails: [],
    changeDetails: [],
    documents: [],
    sources: [],
  };
}

/** The fixture's report id, the job it documents and the office member who approved it. */
export const CONTRACT_REPORT = {
  artifactId: '00000000-0000-4000-8000-000000000157',
  revisionId: '00000000-0000-4000-8000-000000001157',
  jobId: '00000000-0000-4000-8000-000000000151',
  approver: 'contract-office',
} as const;

/** An approved, customer-facing Arbeitsbericht that waits for the customer's decision. */
export function approvedCustomerReport(): WorkArtifactDetail {
  const submitted = savedDetail({
    artifactId: CONTRACT_REPORT.artifactId,
    revisionId: CONTRACT_REPORT.revisionId,
    expectedVersion: null,
    targetType: 'job',
    targetId: CONTRACT_REPORT.jobId,
    kind: 'work_report',
    visibility: 'customer_facing',
    capturedAt: '2026-11-09T08:00:00.000Z',
    title: 'Wartung Heizung',
    content: { performedWork: 'Brenner gereinigt und Abgaswerte gemessen.' },
    submit: true,
    submitActionId: '00000000-0000-4000-8000-000000002157',
  });
  const [submit] = submitted.actions;
  const approval = submit && {
    ...submit,
    id: '00000000-0000-4000-8000-000000003157',
    action_type: 'internal_approved' as const,
    created_by: CONTRACT_REPORT.approver,
  };
  const reviewed = approval ? [approval, submit] : submitted.actions;
  // A coworker's recorded decision as the field projection hands it out: signer and signature document hidden.
  const redacted = (id: string, actionType: WorkArtifactActionRow['action_type']) =>
    approval && { ...approval, id, action_type: actionType, created_by: 'contract-coworker' };
  const decision =
    window.uiContractRedactedDecision &&
    redacted('00000000-0000-4000-8000-000000004157', 'customer_acknowledged');
  const signature =
    (window.uiContractRedactedDecision || window.uiContractLegacySignature) &&
    redacted('00000000-0000-4000-8000-000000005157', 'signature_captured');
  const named = (id: string, actionType: WorkArtifactActionRow['action_type'], signer: string) =>
    approval && {
      ...approval,
      id,
      action_type: actionType,
      created_by: 'contract-coworker',
      signer_name: signer,
      signer_relationship: 'Ansprechperson vor Ort',
      signature_document_id: actionType === 'signature_captured' ? 'contract-split-signature' : null,
    };
  const split = window.uiContractSplitSigners
    ? [
        named('00000000-0000-4000-8000-000000005257', 'signature_captured', 'Max Beispiel'),
        named('00000000-0000-4000-8000-000000004257', 'customer_acknowledged', 'Erika Beispiel'),
      ]
    : [];
  const recorded = [signature, decision, ...split].filter(
    (action) => action !== undefined && action !== false,
  );
  return {
    ...submitted,
    status: 'approved',
    version: 2 + recorded.length,
    actions: [...recorded, ...reviewed],
  };
}

/** The detail read of the fixture's report, as `getWorkArtifactDetail` answers it. */
export async function readWorkArtifactDetailContract(): Promise<
  { success: true; artifact: WorkArtifactDetail } | { success: false; error: string }
> {
  const detail = window.uiContractWorkArtifacts.detail;
  return detail
    ? { success: true, artifact: structuredClone(detail) }
    : { success: false, error: 'work_artifact_not_found' };
}

// A drawn signature as the view URL serves it: a stroke on the pad's background.
const SIGNATURE_IMAGE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 96"><rect width="240" height="96" fill="white"/><path d="M14 66c18-40 30-44 34-20s10 30 24 2 22-36 30-6 12 26 30 0 26-20 40 4 22 10 52-14" fill="none" stroke="black" stroke-width="3" stroke-linecap="round"/></svg>',
)}`;

/** The signature document's short-lived view URL, as the `document-view-url` read answers it. */
export async function readSignatureViewContract(): Promise<
  { success: true; signedUrl: string } | { success: false; error: string }
> {
  const state = window.uiContractWorkArtifacts;
  if (state.failSignatureView) return { success: false, error: 'signed_url_failed' };
  return {
    success: true,
    signedUrl: state.brokenSignatureImage ? 'data:image/png;base64,kaputt' : SIGNATURE_IMAGE,
  };
}

export const saveWorkArtifact: WorkArtifactActions['saveWorkArtifact'] = async (input) => {
  if (window.uiContractWorkArtifacts.loseSaveAnswer) throw new TypeError('Failed to fetch');
  window.uiContractWorkArtifacts.saves.push(structuredClone(input));
  const artifact = savedDetail(input);
  return {
    success: true,
    artifactId: artifact.id,
    version: artifact.version,
    status: artifact.status,
    artifact,
  };
};

/** One customer action row of the fixture's report, as the database writes it. */
function customerAction(
  input: CustomerDecisionInput,
  id: string,
  actionType: WorkArtifactActionRow['action_type'],
  signatureDocumentId: string | null,
): WorkArtifactActionRow {
  return {
    id,
    artifact_id: input.artifactId,
    revision_id: input.revisionId,
    organization_id: 'contract-organization',
    action_type: actionType,
    created_at: new Date().toISOString(),
    created_by: 'contract-worker',
    reason: actionType === 'signature_captured' ? null : (input.reason ?? null),
    comment: null,
    capture_method: signatureDocumentId ? 'Unterschrift auf dem Gerät' : 'Persönlich vor Ort',
    responsibility_snapshot: null,
    signature_document_id: signatureDocumentId,
    signer_company_context: null,
    signer_name: input.signer.name,
    signer_relationship: input.signer.relationship,
    signer_role: input.signer.role ?? null,
    witness_context: null,
    wording_snapshot: 'Wortlaut',
  };
}

/** Records the decision and its signature on the fixture's report in one save, or refuses as the spec set. */
export const recordWorkArtifactCustomerDecision: CustomerDecisionActions['recordWorkArtifactCustomerDecision'] =
  async (input) => {
    const state = window.uiContractWorkArtifacts;
    state.decisions.push(structuredClone(input));
    const detail = state.detail;
    if (!detail) return { success: false, error: 'work_artifact_not_found' };
    if (state.refuseDecision) return { success: false, error: state.refuseDecision };
    // The action ids are idempotency keys, as in record_work_artifact_customer_decision:
    // a repeated save returns what was recorded.
    if (detail.actions.some((action) => action.id === input.decisionActionId))
      return { success: true, artifactId: detail.id, version: detail.version, status: detail.status };
    const decision = customerAction(input, input.decisionActionId, input.decision, null);
    const signature = input.signature
      ? [customerAction(input, input.signature.actionId, 'signature_captured', input.signature.documentId)]
      : [];
    const version = detail.version + 1 + signature.length;
    state.detail = { ...detail, version, actions: [...signature, decision, ...detail.actions] };
    if (state.loseDecisionAnswer) {
      state.loseDecisionAnswer = false;
      throw new Error('The answer was lost.');
    }
    return { success: true, artifactId: detail.id, version, status: detail.status };
  };

/** The signature upload: the server would reserve and store it; here it records the file name. */
export const uploadWorkArtifactSignatureDirect: UploadClient['uploadWorkArtifactSignatureDirect'] = async ({
  file,
}) => {
  const uploads = window.uiContractWorkArtifacts.signatureUploads;
  uploads.push(file.name);
  return {
    success: true,
    document: contractDocument(
      `00000000-0000-4000-8000-${String(uploads.length).padStart(12, '0')}`,
      file.name,
    ),
  };
};

export const discardUnlinkedWorkArtifactSignature: WorkArtifactActions['discardUnlinkedWorkArtifactSignature'] =
  async (documentId) => {
    const state = window.uiContractWorkArtifacts;
    // As the server: a signature a recorded action links is no longer discardable.
    if (state.detail?.actions.some((action) => action.signature_document_id === documentId))
      return { success: false, error: 'work_artifact_signature_in_use' };
    state.discards.push(documentId);
    return { success: true };
  };

export const recordWorkArtifactAction = unexpectedWrite;
export const voidWorkArtifact = unexpectedWrite;
export const exportWorkArtifact = unexpectedWrite;
export const fulfillInstructionEvidence = unexpectedWrite;
export const linkWorkArtifactDocument = unexpectedWrite;
export const linkWorkArtifactSource = unexpectedWrite;
export const removeInstructionEvidenceFulfillment = unexpectedWrite;
