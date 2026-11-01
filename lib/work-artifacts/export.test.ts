import { describe, expect, test } from 'bun:test';

import { buildWorkArtifactExport } from './export';
import type { WorkArtifactActionRow, WorkArtifactDetail } from './types';

const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000010';
const AUTHOR_ID = '00000000-0000-4000-8000-000000000011';
const REVISION_ID = '00000000-0000-4000-8000-000000000002';

const artifact: WorkArtifactDetail = {
  id: '00000000-0000-4000-8000-000000000001',
  organization_id: ORGANIZATION_ID,
  job_id: null,
  project_id: null,
  kind: 'measurement',
  status: 'approved',
  current_revision_id: REVISION_ID,
  version: 1,
  void_reason: null,
  voided_at: null,
  voided_by: null,
  created_at: '2026-08-24T08:00:00+00:00',
  created_by: AUTHOR_ID,
  updated_at: '2026-08-24T08:00:00+00:00',
  revisions: [
    {
      id: '00000000-0000-4000-8000-000000000002',
      artifact_id: '00000000-0000-4000-8000-000000000001',
      organization_id: ORGANIZATION_ID,
      revision_number: 2,
      kind: 'measurement',
      title: 'Aufmaß <Heizraum>',
      visibility: 'internal_only',
      captured_at: '2026-08-24T08:00:00+00:00',
      created_at: '2026-08-24T08:00:00+00:00',
      created_by: AUTHOR_ID,
      measurement_date: '2026-08-24',
      measurement_location: 'Keller & Flur',
      measurement_notes: null,
      correction_reason: null,
      corrects_revision_id: null,
      customer_statement: null,
      decisions: null,
      deliveries: null,
      impediments: null,
      instruction_item_id: null,
      materials_summary: null,
      next_visit_at: null,
      notable_events: null,
      outstanding_work: null,
      people_present: null,
      performed_work: null,
      progress: null,
      requires_customer_response: false,
      requires_signature: false,
      site_conditions: null,
      site_id: null,
      summary: null,
      visit_ended_at: null,
      visit_started_at: null,
      weather_conditions: null,
      work_date: null,
    },
  ],
  measurementLines: [
    {
      id: '00000000-0000-4000-8000-000000000003',
      organization_id: ORGANIZATION_ID,
      revision_id: '00000000-0000-4000-8000-000000000002',
      line_number: 1,
      description: 'Kupferrohr',
      location: 'Keller',
      quantity: 2.5,
      unit: 'meter',
      note: null,
    },
  ],
  defectDetails: [],
  changeDetails: [],
  documents: [],
  sources: [],
  actions: [],
};

/** An action on the current revision without a signer, reason or comment. */
function revisionAction(
  id: string,
  actionType: WorkArtifactActionRow['action_type'],
  createdAt: string,
): WorkArtifactActionRow {
  return {
    id,
    organization_id: ORGANIZATION_ID,
    artifact_id: artifact.id,
    revision_id: REVISION_ID,
    action_type: actionType,
    created_at: createdAt,
    created_by: AUTHOR_ID,
    capture_method: null,
    comment: null,
    reason: null,
    responsibility_snapshot: null,
    signature_document_id: null,
    signer_company_context: null,
    signer_name: null,
    signer_relationship: null,
    signer_role: null,
    witness_context: null,
    wording_snapshot: null,
  };
}

describe('buildWorkArtifactExport', () => {
  test('is deterministic, escaped and self-identifying', () => {
    const first = buildWorkArtifactExport(artifact);
    const second = buildWorkArtifactExport(artifact);
    expect(first.bytes.equals(second.bytes)).toBe(true);
    expect(first.contentHash).toBe(second.contentHash);
    expect(first.html).toContain(`Inhalts-Hash ${first.contentHash}`);
    expect(first.html).toContain('Aufmaß &lt;Heizraum&gt;');
    expect(first.html).toContain('Keller &amp; Flur');
    // The meta line names the status by its label, never by its code.
    expect(first.html).toContain('Status Intern freigegeben · Renderer');
    expect(first.fileName).toBe(`Arbeitsnachweis-00000000-V2-${first.contentHash.slice(0, 8)}.html`);
  });

  test('keeps retry identity after the export event and document were recorded', () => {
    const first = buildWorkArtifactExport(artifact);
    const afterExport: WorkArtifactDetail = {
      ...artifact,
      actions: [
        revisionAction('00000000-0000-4000-8000-000000000004', 'exported', '2026-08-24T08:01:00+00:00'),
      ],
      documents: [
        {
          id: '00000000-0000-4000-8000-000000000005',
          organization_id: ORGANIZATION_ID,
          revision_id: REVISION_ID,
          relation: 'rendered_export',
          document_id: '00000000-0000-4000-8000-000000000012',
          description: null,
          content_hash: null,
          renderer_version: null,
          created_at: '2026-08-24T08:01:00+00:00',
          created_by: AUTHOR_ID,
        },
      ],
    };

    expect(buildWorkArtifactExport(afterExport).contentHash).toBe(first.contentHash);
  });

  test('changes identity when a rendered decision changes', () => {
    const first = buildWorkArtifactExport(artifact);
    const afterApproval: WorkArtifactDetail = {
      ...artifact,
      actions: [
        revisionAction(
          '00000000-0000-4000-8000-000000000006',
          'internal_approved',
          '2026-08-24T09:00:00+00:00',
        ),
      ],
    };
    expect(buildWorkArtifactExport(afterApproval).contentHash).not.toBe(first.contentHash);
  });
});
