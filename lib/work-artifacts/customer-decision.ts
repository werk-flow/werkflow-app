import type { WorkArtifactActionRow, WorkArtifactActionType, WorkArtifactDetail } from './types';

/** The customer's answer to a customer-facing revision; a revision holds at most one. */
export const CUSTOMER_DECISION_TYPES = [
  'customer_acknowledged',
  'customer_reserved',
  'customer_refused',
] as const satisfies readonly WorkArtifactActionType[];

export type CustomerDecisionType = (typeof CUSTOMER_DECISION_TYPES)[number];

export const CUSTOMER_DECISION_LABELS: Readonly<Record<CustomerDecisionType, string>> = {
  customer_acknowledged: 'Bestätigt',
  customer_reserved: 'Mit Vorbehalt bestätigt',
  customer_refused: 'Abgelehnt',
};

/** A refusal or a reservation states the customer's reason. */
export function customerDecisionNeedsReason(decision: CustomerDecisionType): boolean {
  return decision !== 'customer_acknowledged';
}

export function isCustomerDecisionType(value: string): value is CustomerDecisionType {
  return CUSTOMER_DECISION_TYPES.some((type) => type === value);
}

/** The decision and the signature recorded on one revision; either may be missing in older records. */
export type RecordedCustomerDecision = {
  decision: (WorkArtifactActionRow & { action_type: CustomerDecisionType }) | null;
  signature: WorkArtifactActionRow | null;
};

/**
 * What the customer recorded on the revision, or null while nothing is
 * recorded. A recorded decision or signature closes the revision to a second
 * one (`work_artifact_customer_decision_recorded`). The dialog shows a
 * recorded decision instead of the form; a signature an earlier release saved
 * alone still leaves the decision to record.
 */
export function recordedCustomerDecision(
  detail: Pick<WorkArtifactDetail, 'actions'>,
  revisionId: string,
): RecordedCustomerDecision | null {
  let decision: RecordedCustomerDecision['decision'] = null;
  let signature: RecordedCustomerDecision['signature'] = null;
  for (const action of detail.actions) {
    if (action.revision_id !== revisionId) continue;
    const type = action.action_type;
    if (isCustomerDecisionType(type)) decision ??= { ...action, action_type: type };
    else if (type === 'signature_captured') signature ??= action;
  }
  return decision || signature ? { decision, signature } : null;
}
