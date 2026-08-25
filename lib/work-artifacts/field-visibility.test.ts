import { describe, expect, test } from 'bun:test';

import { redactWorkArtifactActionForField } from './field-visibility';
import type { WorkArtifactActionRow } from './types';

describe('work artifact field visibility', () => {
  test('removes every signer field from a coworker action', () => {
    const action = {
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
    } as unknown as WorkArtifactActionRow;

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
    const action = {
      created_by: 'viewer',
      responsibility_snapshot: { internal: true },
      signer_name: 'Kim Beispiel',
      capture_method: 'pointer',
      signature_document_id: 'document-1',
    } as unknown as WorkArtifactActionRow;

    const redacted = redactWorkArtifactActionForField(action, 'viewer');

    expect(redacted.responsibility_snapshot).toBeNull();
    expect(redacted.signer_name).toBe('Kim Beispiel');
    expect(redacted.capture_method).toBe('pointer');
    expect(redacted.signature_document_id).toBe('document-1');
  });
});
