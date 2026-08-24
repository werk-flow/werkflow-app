import { describe, expect, test } from 'bun:test';

import { buildWorkArtifactExport } from './export';
import type { WorkArtifactDetail } from './types';

const artifact = {
  id: '00000000-0000-4000-8000-000000000001', kind: 'measurement', status: 'approved',
  current_revision_id: '00000000-0000-4000-8000-000000000002',
  revisions: [{ id: '00000000-0000-4000-8000-000000000002', artifact_id: '00000000-0000-4000-8000-000000000001',
    revision_number: 2, kind: 'measurement', title: 'Aufmaß <Heizraum>', captured_at: '2026-08-24T08:00:00+00:00',
    created_at: '2026-08-24T08:00:00+00:00', measurement_date: '2026-08-24', measurement_location: 'Keller & Flur' }],
  measurementLines: [{ id: '00000000-0000-4000-8000-000000000003', revision_id: '00000000-0000-4000-8000-000000000002',
    line_number: 1, description: 'Kupferrohr', location: 'Keller', quantity: 2.5, unit: 'meter', note: null }],
  defectDetails: [], changeDetails: [], documents: [], sources: [], actions: [],
} as unknown as WorkArtifactDetail;

describe('buildWorkArtifactExport', () => {
  test('is deterministic, escaped and self-identifying', () => {
    const first = buildWorkArtifactExport(artifact);
    const second = buildWorkArtifactExport(artifact);
    expect(first.bytes.equals(second.bytes)).toBe(true);
    expect(first.contentHash).toBe(second.contentHash);
    expect(first.html).toContain(`Inhalts-Hash ${first.contentHash}`);
    expect(first.html).toContain('Aufmaß &lt;Heizraum&gt;');
    expect(first.html).toContain('Keller &amp; Flur');
    expect(first.fileName).toBe(`Arbeitsnachweis-00000000-V2-${first.contentHash.slice(0, 8)}.html`);
  });

  test('keeps retry identity after the export event and document were recorded', () => {
    const first = buildWorkArtifactExport(artifact);
    const afterExport = {
      ...artifact,
      actions: [{ id: '00000000-0000-4000-8000-000000000004',
        revision_id: artifact.current_revision_id, action_type: 'exported', created_at: '2026-08-24T08:01:00+00:00' }],
      documents: [{ id: '00000000-0000-4000-8000-000000000005',
        revision_id: artifact.current_revision_id, relation: 'rendered_export' }],
    } as unknown as WorkArtifactDetail;

    expect(buildWorkArtifactExport(afterExport).contentHash).toBe(first.contentHash);
  });

  test('changes identity when a rendered decision changes', () => {
    const first = buildWorkArtifactExport(artifact);
    const afterApproval = { ...artifact, actions: [{
      id: '00000000-0000-4000-8000-000000000006', revision_id: artifact.current_revision_id,
      action_type: 'internal_approved', created_at: '2026-08-24T09:00:00+00:00',
    }] } as unknown as WorkArtifactDetail;
    expect(buildWorkArtifactExport(afterApproval).contentHash).not.toBe(first.contentHash);
  });
});
