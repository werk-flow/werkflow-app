import { describe, expect, test } from 'bun:test';

import { redactWorkArtifactActionForField } from './field-visibility';
import type { WorkArtifactActionRow } from './types';

// The action facts the redaction passes through unchanged; each test names the signer fields it checks.
const ACTION_ROW: WorkArtifactActionRow = {
  action_type: 'review_requested',
  artifact_id: 'artifact-1',
  capture_method: null,
  comment: null,
  created_at: '2026-08-20T08:00:00.000Z',
  created_by: 'viewer',
  id: 'action-1',
  organization_id: 'org-1',
  reason: null,
  responsibility_snapshot: null,
  revision_id: 'revision-1',
  signature_document_id: null,
  signer_company_context: null,
  signer_name: null,
  signer_relationship: null,
  signer_role: null,
  witness_context: null,
  wording_snapshot: null,
};

describe('work artifact field visibility', () => {
  test('removes every signer field from a coworker action', () => {
    const action: WorkArtifactActionRow = {
      ...ACTION_ROW,
      created_by: 'coworker',
      responsibility_snapshot: { internal: true },
      signer_name: 'Sensitive Name',
      signer_role: 'Customer role',
      signer_relationship: 'Owner',
      signer_company_context: 'Sensitive company',
      capture_method: 'pointer',
      wording_snapshot: 'Sensitive wording',
      witness_context: 'Sensitive witness',
      signature_document_id: 'document-1',
    };

    const redacted = redactWorkArtifactActionForField(action, 'viewer');

    expect(redacted.responsibility_snapshot).toBeNull();
    expect(redacted.signer_name).toBeNull();
    expect(redacted.signer_role).toBeNull();
    expect(redacted.signer_relationship).toBeNull();
    expect(redacted.signer_company_context).toBeNull();
    expect(redacted.capture_method).toBeNull();
    expect(redacted.wording_snapshot).toBeNull();
    expect(redacted.witness_context).toBeNull();
    expect(redacted.signature_document_id).toBeNull();
  });

  test('keeps signer fields on the viewer own action', () => {
    const action: WorkArtifactActionRow = {
      ...ACTION_ROW,
      created_by: 'viewer',
      responsibility_snapshot: { internal: true },
      signer_name: 'Kim Beispiel',
      capture_method: 'pointer',
      signature_document_id: 'document-1',
    };

    const redacted = redactWorkArtifactActionForField(action, 'viewer');

    expect(redacted.responsibility_snapshot).toBeNull();
    expect(redacted.signer_name).toBe('Kim Beispiel');
    expect(redacted.capture_method).toBe('pointer');
    expect(redacted.signature_document_id).toBe('document-1');
  });
});
