import { describe, expect, test } from 'bun:test';

import { recordedCustomerDecision } from './customer-decision';
import type { WorkArtifactActionRow } from './types';

const current = 'revision-current';

function action(id: string, actionType: WorkArtifactActionRow['action_type'], revisionId = current) {
  return {
    id,
    artifact_id: 'artifact',
    revision_id: revisionId,
    organization_id: 'organization',
    action_type: actionType,
    created_at: '2026-11-09T08:00:00.000Z',
    created_by: 'worker',
    reason: null,
    comment: null,
    capture_method: null,
    responsibility_snapshot: null,
    signature_document_id: actionType === 'signature_captured' ? 'document' : null,
    signer_company_context: null,
    signer_name: 'Erika Beispiel',
    signer_relationship: 'Ansprechperson vor Ort',
    signer_role: null,
    witness_context: null,
    wording_snapshot: null,
  } satisfies WorkArtifactActionRow;
}

describe('recordedCustomerDecision', () => {
  test('nothing is recorded while the revision has only review steps', () => {
    const actions = [action('approved', 'internal_approved'), action('submitted', 'review_requested')];
    expect(recordedCustomerDecision({ actions }, current)).toBeNull();
  });

  test('the decision and the signature of the current revision', () => {
    const actions = [
      action('signature', 'signature_captured'),
      action('decision', 'customer_reserved'),
      action('earlier', 'customer_acknowledged', 'revision-earlier'),
    ];
    const recorded = recordedCustomerDecision({ actions }, current);
    expect(recorded?.decision?.id).toBe('decision');
    expect(recorded?.signature?.id).toBe('signature');
  });

  test('an earlier revision decision never closes a new revision', () => {
    const actions = [action('earlier', 'customer_acknowledged', 'revision-earlier')];
    expect(recordedCustomerDecision({ actions }, current)).toBeNull();
  });

  test('an older record with only a signature counts as recorded', () => {
    const recorded = recordedCustomerDecision(
      { actions: [action('signature', 'signature_captured')] },
      current,
    );
    expect(recorded).toMatchObject({ decision: null, signature: { id: 'signature' } });
  });
});
