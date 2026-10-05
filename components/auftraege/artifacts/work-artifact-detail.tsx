'use client';

import { FormDisclosure } from '@/components/ui/form-disclosure';
import type { OrganizationDocument } from '@/lib/documents/types';
import { formatDecimalDe } from '@/lib/ui/decimal';
import { formatBerlinDateTime as displayDateTime, formatGermanDate } from '@/lib/utils';
import {
  WORK_ARTIFACT_UNIT_LABELS,
  type WorkArtifactActionType,
  type WorkArtifactDetail,
} from '@/lib/work-artifacts/types';
import {
  AUTHORIZATION_STATE_LABELS,
  DEFECT_SEVERITY_LABELS,
  DEFECT_STATE_LABELS,
} from './work-artifact-content';

const ACTION_LABELS: Partial<Record<WorkArtifactActionType, string>> = {
  review_requested: 'Zur Prüfung eingereicht',
  review_withdrawn: 'Prüfung zurückgezogen',
  internal_approved: 'Intern freigegeben',
  internal_rejected: 'Abgelehnt',
  correction_requested: 'Korrektur angefordert',
  customer_acknowledged: 'Vom Kunden bestätigt',
  customer_refused: 'Vom Kunden abgelehnt',
  customer_reserved: 'Mit Vorbehalt bestätigt',
  signature_captured: 'Unterschrift erfasst',
  exported: 'Export erstellt',
  voided: 'Ungültig gesetzt',
};
const DOCUMENT_RELATION_LABELS = {
  supporting_evidence: 'Nachweis',
  closure_proof: 'Abschlussnachweis',
  signature_mark: 'Unterschrift',
  rendered_export: 'Gerenderter Export',
} as const;

type ArtifactDetailProps = {
  detail: WorkArtifactDetail;
  currentRevision: WorkArtifactDetail['revisions'][number];
  currentUserId: string;
  documents: OrganizationDocument[];
};

export function ArtifactDetail({ detail, currentRevision, currentUserId, documents }: ArtifactDetailProps) {
  // A document linked without a description shows its file name, never its id.
  const documentNames = new Map(documents.map((document) => [document.id, document.displayName]));
  const defect = detail.defectDetails.find((entry) => entry.revision_id === currentRevision.id);
  const change = detail.changeDetails.find((entry) => entry.revision_id === currentRevision.id);
  // Only absent values are hidden: zero labor minutes is a recorded value.
  const fields = [
    ['Zusammenfassung', currentRevision.summary],
    ['Fortschritt', currentRevision.progress],
    ['Ausgeführte Arbeiten', currentRevision.performed_work],
    ['Offene Arbeiten', currentRevision.outstanding_work],
    ['Material', currentRevision.materials_summary],
    ['Kundenaussage', currentRevision.customer_statement],
    ['Aufmaßort', currentRevision.measurement_location],
    ['Hinweise', currentRevision.measurement_notes],
    ['Mangelbeschreibung', defect?.description],
    ['Schweregrad', defect && DEFECT_SEVERITY_LABELS[defect.severity]],
    ['Mangelort', defect?.location],
    ['Fällig am', formatGermanDate(defect?.due_date, { empty: '' })],
    ['Mangelstatus', defect && DEFECT_STATE_LABELS[defect.state]],
    ['Zuständigkeit', defect?.responsibility_context],
    ['Vorgeschlagene Lösung', defect?.proposed_resolution],
    ['Behebung', defect?.resolution_summary],
    ['Änderungs-/Regiearbeit', change?.change_description],
    ['Änderungsgrund', change?.change_reason],
    ['Angefordert durch', change?.requested_by_context],
    ['Erwartete Arbeitsminuten', change?.expected_labor_minutes],
    ['Tatsächliche Arbeitsminuten', change?.actual_labor_minutes],
    ['Erwartetes Material', change?.expected_material_summary],
    ['Tatsächliches Material', change?.actual_material_summary],
    ['Autorisierungsstand', change && AUTHORIZATION_STATE_LABELS[change.authorization_state]],
    ['Terminauswirkung', change?.schedule_impact],
  ].filter(([, value]) => value !== null && value !== undefined && value !== '');
  return (
    <div className="space-y-5">
      <div className="grid gap-3 rounded-md border bg-muted/20 p-4 sm:grid-cols-2">
        <div>
          <p className="text-xs text-muted-foreground">Erfasst am</p>
          <p className="text-sm">{displayDateTime(currentRevision.captured_at)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Sichtbarkeit</p>
          <p className="text-sm">
            {currentRevision.visibility === 'customer_facing' ? 'Kundendokumentation' : 'Nur intern'}
          </p>
        </div>
      </div>
      {fields.map(([label, value]) => (
        <div key={label}>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm">{value}</p>
        </div>
      ))}
      {detail.measurementLines.filter((line) => line.revision_id === currentRevision.id).length > 0 && (
        <div className="overflow-hidden rounded-md border">
          <div className="grid grid-cols-[1fr_auto_auto] gap-2 bg-muted/40 px-3 py-2 text-xs font-medium">
            <span>Position</span>
            <span>Menge</span>
            <span>Einheit</span>
          </div>
          {detail.measurementLines
            .filter((line) => line.revision_id === currentRevision.id)
            .map((line) => (
              <div key={line.id} className="grid grid-cols-[1fr_auto_auto] gap-2 border-t px-3 py-2 text-sm">
                <span>{line.description}</span>
                <span className="tabular-nums">{formatDecimalDe(line.quantity, 3)}</span>
                <span>{WORK_ARTIFACT_UNIT_LABELS[line.unit]}</span>
              </div>
            ))}
        </div>
      )}
      {detail.documents.filter((document) => document.revision_id === currentRevision.id).length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Verknüpfte Dokumente
          </p>
          <div className="mt-2 divide-y rounded-md border">
            {detail.documents
              .filter((document) => document.revision_id === currentRevision.id)
              .map((document) => (
                <p key={document.id} className="p-3 text-sm">
                  {DOCUMENT_RELATION_LABELS[document.relation]} ·{' '}
                  {document.description ?? documentNames.get(document.document_id) ?? 'Dokument'}
                </p>
              ))}
          </div>
        </div>
      )}
      {detail.sources.filter((source) => source.revision_id === currentRevision.id).length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Quellen</p>
          <div className="mt-2 divide-y rounded-md border">
            {detail.sources
              .filter((source) => source.revision_id === currentRevision.id)
              .map((source) => (
                <p key={source.id} className="p-3 text-sm">
                  {source.time_segment_id
                    ? 'Aktivitätsabschnitt'
                    : source.time_entry_id
                      ? 'Zeiteintrag'
                      : 'Bestandsbewegung'}
                  {source.description && ` · ${source.description}`}
                </p>
              ))}
          </div>
        </div>
      )}
      <FormDisclosure
        label={`Verlauf (${detail.revisions.length} Versionen, ${detail.actions.length} Aktionen)`}
      >
        <div className="space-y-3">
          <div className="divide-y rounded-md border">
            {detail.revisions.map((revision) => (
              <div key={revision.id} className="p-3 text-sm">
                <p className="font-medium">
                  Version {revision.revision_number} · {revision.title}
                </p>
                <p className="text-xs text-muted-foreground">
                  {displayDateTime(revision.created_at)}
                  {revision.created_by === currentUserId ? ' · von dir' : ''}
                  {revision.correction_reason ? ` · ${revision.correction_reason}` : ''}
                </p>
              </div>
            ))}
          </div>
          {detail.actions.length > 0 && (
            <div className="divide-y rounded-md border">
              {detail.actions.map((action) => (
                <div key={action.id} className="p-3 text-sm">
                  <p className="font-medium">{ACTION_LABELS[action.action_type] ?? action.action_type}</p>
                  <p className="text-xs text-muted-foreground">
                    {displayDateTime(action.created_at)}
                    {action.signer_name ? ` · ${action.signer_name}` : ''}
                    {action.reason ? ` · ${action.reason}` : ''}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </FormDisclosure>
    </div>
  );
}
