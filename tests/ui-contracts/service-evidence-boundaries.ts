// Isolated server state of the service-case evidence link: one job with two
// unlinked evidence versions. A link waits in the write gate; an accepted link
// becomes part of the next live read.
import type { ServiceCaseDetail, ServiceCaseEvidenceOption } from '@/lib/service-cases/types';
import { holdWrite, unexpectedWrite } from './held-write-boundary';

export const serviceEvidenceOptions: ServiceCaseEvidenceOption[] = [
  {
    revisionId: 'contract-revision-report',
    artifactId: 'contract-artifact-report',
    revisionNumber: 2,
    title: 'Arbeitsbericht Kesseltausch',
    kind: 'work_report',
  },
  {
    revisionId: 'contract-revision-measurement',
    artifactId: 'contract-artifact-measurement',
    revisionNumber: 1,
    title: 'Aufmaß Heizraum',
    kind: 'measurement',
  },
];

declare global {
  interface Window {
    uiContractServiceEvidence: { evidence: ServiceCaseDetail['evidence']; reads: number };
  }
}

window.uiContractServiceEvidence = { evidence: [], reads: 0 };

/** The live read of the case: the evidence the server holds right now. */
export function readServiceEvidenceContract(): ServiceCaseDetail['evidence'] {
  window.uiContractServiceEvidence.reads += 1;
  return structuredClone(window.uiContractServiceEvidence.evidence);
}

// `@/lib/service-cases/actions`
export async function linkServiceCaseEvidence(input: {
  serviceCaseId: string;
  workArtifactRevisionId: string;
  expectedVersion: number;
  idempotencyKey: string;
}): Promise<{ success: true } | { success: false; error: string }> {
  const refusal = await holdWrite('link-service-case-evidence', input);
  if (refusal) return { success: false, error: refusal };
  const option = serviceEvidenceOptions.find((entry) => entry.revisionId === input.workArtifactRevisionId);
  if (!option) return { success: false, error: 'service_case_evidence_mismatch' };
  window.uiContractServiceEvidence.evidence = [
    ...window.uiContractServiceEvidence.evidence,
    { ...option, id: `contract-evidence-${option.revisionId}`, createdAt: '2026-10-02T09:00:00.000Z' },
  ];
  return { success: true };
}
export const linkServiceCaseRelation = unexpectedWrite;

// `@/lib/customer-relationships/actions`
export const createCustomerFollowUp = unexpectedWrite;
