import { describe, expect, test } from 'bun:test';

import { saveWorkArtifactSchema, workArtifactActionSchema } from './validation';

const id = '00000000-0000-4000-8000-000000000001';
const base = {
  artifactId: id, revisionId: '00000000-0000-4000-8000-000000000002',
  expectedVersion: null, targetType: 'job' as const,
  targetId: '00000000-0000-4000-8000-000000000003',
  visibility: 'internal_only' as const, capturedAt: '2026-08-24T08:00:00+02:00',
  title: 'Montage vor Ort', submit: false,
};

describe('saveWorkArtifactSchema', () => {
  test.each([
    ['site_diary', { workDate: '2026-08-24', progress: 'Leitungen montiert' }],
    ['work_report', { performedWork: 'Anlage geprüft' }],
    ['measurement', { measurementDate: '2026-08-24', measurementLocation: 'Keller', measurementLines: [{ description: 'Rohr', quantity: '2,5', unit: 'meter' }] }],
    ['defect', { defectDescription: 'Ventil undicht', defectSeverity: 'high', defectLocation: 'Heizraum' }],
    ['change_work', { changeDescription: 'Zusätzliche Leitung', changeReason: 'Bestandsabweichung', requestedByContext: 'Bauleitung' }],
  ])('accepts meaningful %s content', (kind, content) => {
    expect(saveWorkArtifactSchema.safeParse({ ...base, kind, content }).success).toBe(true);
  });

  test('requires a customer-facing revision for customer outcomes', () => {
    const result = saveWorkArtifactSchema.safeParse({
      ...base, kind: 'work_report', content: { performedWork: 'Anlage geprüft', requiresSignature: true },
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toContainEqual(expect.objectContaining({
      path: ['visibility'], message: 'customer_visibility_required',
    }));
  });

  test('requires an idempotency key when submitting', () => {
    const result = saveWorkArtifactSchema.safeParse({
      ...base, kind: 'site_diary', content: { progress: 'Montage', workDate: '2026-08-24' }, submit: true,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toContainEqual(expect.objectContaining({
      path: ['submitActionId'], message: 'submit_action_required',
    }));
  });

  test.each(['0', '100000000000'])('rejects out-of-range measurement quantity %s', (quantity) => {
    const result = saveWorkArtifactSchema.safeParse({
      ...base, kind: 'measurement', content: { measurementLocation: 'Keller',
        measurementLines: [{ description: 'Rohr', quantity, unit: 'meter' }] },
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((issue) =>
      issue.path.join('.').startsWith('content.measurementLines.0.quantity'))).toBe(true);
  });

  test('requires a strictly increasing visit window', () => {
    const result = saveWorkArtifactSchema.safeParse({
      ...base, kind: 'work_report', content: { performedWork: 'Anlage geprüft',
        visitStartedAt: '2026-08-24T09:00:00+02:00', visitEndedAt: '2026-08-24T08:00:00+02:00' },
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toContainEqual(expect.objectContaining({
      path: ['content', 'visitEndedAt'], message: 'visit_end_must_be_after_start',
    }));
  });

  test('requires kind-specific completion before submission', () => {
    const result = saveWorkArtifactSchema.safeParse({
      ...base, kind: 'measurement', content: { measurementLocation: 'Keller' },
      submit: true, submitActionId: '00000000-0000-4000-8000-000000000010',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining(['measurement_date_required', 'measurement_lines_required'])
    );
  });

  test('requires correction revision and reason together', () => {
    const result = saveWorkArtifactSchema.safeParse({
      ...base, kind: 'work_report', content: { performedWork: 'Anlage geprüft' },
      correctsRevisionId: '00000000-0000-4000-8000-000000000009',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((issue) => issue.message))
      .toContain('correction_pair_required');
  });
});

describe('workArtifactActionSchema', () => {
  test('accepts exact customer context for a refusal', () => {
    expect(workArtifactActionSchema.safeParse({
      artifactId: id, revisionId: base.revisionId,
      actionId: '00000000-0000-4000-8000-000000000004', expectedVersion: 2,
      actionType: 'customer_refused', reason: 'Leistung nicht vollständig',
      customerContext: { signerName: 'Erika Mustermann', signerRelationship: 'Auftraggeberin',
        captureMethod: 'Persönlich vor Ort', wordingSnapshot: 'Bestätigung für diese Version.' },
    }).success).toBe(true);
  });

  test.each([
    ['customer_refused', { reason: 'Nicht vollständig' }, 'customer_context_required'],
    ['customer_reserved', { customerContext: { signerName: 'Erika Mustermann',
      signerRelationship: 'Auftraggeberin', captureMethod: 'Vor Ort', wordingSnapshot: 'Version bestätigt.' } }, 'reason_required'],
    ['signature_captured', { customerContext: { signerName: 'Erika Mustermann',
      signerRelationship: 'Auftraggeberin', captureMethod: 'Vor Ort', wordingSnapshot: 'Version unterschrieben.' } }, 'signature_document_required'],
  ])('rejects incomplete %s action context', (actionType, extra, expectedMessage) => {
    const result = workArtifactActionSchema.safeParse({
      artifactId: id, revisionId: base.revisionId,
      actionId: '00000000-0000-4000-8000-000000000004', expectedVersion: 2,
      actionType, ...extra,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((issue) => issue.message))
      .toContain(expectedMessage);
  });
});
