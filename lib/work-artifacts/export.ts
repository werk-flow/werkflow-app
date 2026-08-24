import { createHash } from 'node:crypto';

import {
  WORK_ARTIFACT_KIND_LABELS, WORK_ARTIFACT_STATUS_LABELS,
  WORK_ARTIFACT_UNIT_LABELS, type WorkArtifactDetail,
} from './types';

export const WORK_ARTIFACT_EXPORT_RENDERER_VERSION = 'p1-15-html-v3';

const DEFECT_SEVERITY_LABELS = { low: 'Niedrig', medium: 'Mittel', high: 'Hoch', critical: 'Kritisch' } as const;
const DEFECT_STATE_LABELS = { open: 'Offen', in_progress: 'In Bearbeitung', resolved: 'Behoben' } as const;
const AUTHORIZATION_STATE_LABELS = {
  not_requested: 'Nicht angefragt', requested: 'Angefragt', authorized: 'Autorisiert', rejected: 'Abgelehnt',
} as const;
const ACTION_LABELS = {
  review_requested: 'Zur Prüfung eingereicht', review_withdrawn: 'Prüfung zurückgezogen',
  internal_approved: 'Intern freigegeben', internal_rejected: 'Intern abgelehnt',
  correction_requested: 'Korrektur angefordert', customer_acknowledged: 'Vom Kunden bestätigt',
  customer_refused: 'Vom Kunden abgelehnt', customer_reserved: 'Mit Vorbehalt bestätigt',
  signature_captured: 'Unterschrift erfasst', exported: 'Export erstellt', voided: 'Ungültig gesetzt',
} as const;
const DOCUMENT_RELATION_LABELS = {
  supporting_evidence: 'Nachweis', closure_proof: 'Abschlussnachweis',
  signature_mark: 'Unterschrift', rendered_export: 'Gerenderter Export',
} as const;

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

function rows(values: Array<[string, unknown]>): string {
  return values.filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([label, value]) => `<section><h2>${escapeHtml(label)}</h2><p>${escapeHtml(value)}</p></section>`).join('');
}

export function buildWorkArtifactExport(artifact: WorkArtifactDetail): {
  html: string; bytes: Buffer; contentHash: string; rendererVersion: string; fileName: string;
} {
  const revision = artifact.revisions.find((entry) => entry.id === artifact.current_revision_id);
  if (!revision) throw new Error('work_artifact_revision_not_found');
  const measurementLines = artifact.measurementLines.filter((line) => line.revision_id === revision.id)
    .sort((left, right) => left.line_number - right.line_number || left.id.localeCompare(right.id));
  const defect = artifact.defectDetails.find((entry) => entry.revision_id === revision.id) ?? null;
  const change = artifact.changeDetails.find((entry) => entry.revision_id === revision.id) ?? null;
  const actions = artifact.actions.filter((action) => (
    action.revision_id === revision.id && action.action_type !== 'exported'
  ))
    .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id));
  const documents = artifact.documents.filter((document) => (
    document.revision_id === revision.id && document.relation !== 'rendered_export'
  ))
    .sort((left, right) => left.id.localeCompare(right.id));
  const sources = artifact.sources.filter((source) => source.revision_id === revision.id)
    .sort((left, right) => left.id.localeCompare(right.id));
  const renderedRevision = {
    id: revision.id, revision_number: revision.revision_number, kind: revision.kind,
    title: revision.title, captured_at: revision.captured_at, work_date: revision.work_date,
    summary: revision.summary, progress: revision.progress, people_present: revision.people_present,
    weather_conditions: revision.weather_conditions, site_conditions: revision.site_conditions,
    deliveries: revision.deliveries, impediments: revision.impediments, decisions: revision.decisions,
    notable_events: revision.notable_events, visit_started_at: revision.visit_started_at,
    visit_ended_at: revision.visit_ended_at, performed_work: revision.performed_work,
    outstanding_work: revision.outstanding_work, materials_summary: revision.materials_summary,
    next_visit_at: revision.next_visit_at, customer_statement: revision.customer_statement,
    measurement_date: revision.measurement_date, measurement_location: revision.measurement_location,
    measurement_notes: revision.measurement_notes,
  };
  const canonical = JSON.stringify({
    artifact: { id: artifact.id, kind: artifact.kind, status: artifact.status },
    revision: renderedRevision,
    measurementLines: measurementLines.map(({ description, location, quantity, unit, note }) => (
      { description, location, quantity, unit, note }
    )),
    defect: defect && { description: defect.description, severity: defect.severity,
      location: defect.location, due_date: defect.due_date, state: defect.state,
      responsibility_context: defect.responsibility_context,
      proposed_resolution: defect.proposed_resolution, resolution_summary: defect.resolution_summary },
    change: change && { change_description: change.change_description, change_reason: change.change_reason,
      requested_by_context: change.requested_by_context, expected_labor_minutes: change.expected_labor_minutes,
      actual_labor_minutes: change.actual_labor_minutes,
      expected_material_summary: change.expected_material_summary,
      actual_material_summary: change.actual_material_summary,
      authorization_state: change.authorization_state, schedule_impact: change.schedule_impact },
    actions: actions.map(({ created_at, action_type, signer_name, reason, comment }) => (
      { created_at, action_type, signer_name, reason, comment }
    )),
    documents: documents.map(({ document_id, relation, description }) => ({ document_id, relation, description })),
    sources: sources.map(({ time_entry_id, inventory_movement_id, description }) => (
      { time_entry_id, inventory_movement_id, description }
    )),
    rendererVersion: WORK_ARTIFACT_EXPORT_RENDERER_VERSION,
  });
  const contentHash = createHash('sha256').update(canonical, 'utf8').digest('hex');
  const fields: Array<[string, unknown]> = [
    ['Art', WORK_ARTIFACT_KIND_LABELS[revision.kind]], ['Status', WORK_ARTIFACT_STATUS_LABELS[artifact.status]],
    ['Erfasst am', revision.captured_at], ['Arbeitstag', revision.work_date],
    ['Zusammenfassung', revision.summary], ['Fortschritt', revision.progress],
    ['Anwesende Personen', revision.people_present], ['Wetter', revision.weather_conditions],
    ['Bedingungen vor Ort', revision.site_conditions], ['Lieferungen', revision.deliveries],
    ['Behinderungen', revision.impediments], ['Entscheidungen', revision.decisions],
    ['Besondere Ereignisse', revision.notable_events], ['Besuchsbeginn', revision.visit_started_at],
    ['Besuchsende', revision.visit_ended_at], ['Ausgeführte Arbeiten', revision.performed_work],
    ['Offene Arbeiten', revision.outstanding_work], ['Materialhinweise', revision.materials_summary],
    ['Nächster Besuch', revision.next_visit_at], ['Kundenaussage', revision.customer_statement],
    ['Aufmaßdatum', revision.measurement_date], ['Aufmaßort', revision.measurement_location],
    ['Aufmaßhinweise', revision.measurement_notes], ['Mangelbeschreibung', defect?.description],
    ['Schweregrad', defect?.severity ? DEFECT_SEVERITY_LABELS[defect.severity] : null], ['Mangelort', defect?.location], ['Fällig am', defect?.due_date],
    ['Mangelstatus', defect?.state ? DEFECT_STATE_LABELS[defect.state] : null], ['Zuständigkeit', defect?.responsibility_context],
    ['Vorgeschlagene Lösung', defect?.proposed_resolution], ['Behebung', defect?.resolution_summary],
    ['Änderungs-/Regiearbeit', change?.change_description], ['Änderungsgrund', change?.change_reason],
    ['Angefordert durch', change?.requested_by_context], ['Erwartete Arbeitsminuten', change?.expected_labor_minutes],
    ['Tatsächliche Arbeitsminuten', change?.actual_labor_minutes], ['Erwartetes Material', change?.expected_material_summary],
    ['Tatsächliches Material', change?.actual_material_summary], ['Autorisierungsstand', change?.authorization_state ? AUTHORIZATION_STATE_LABELS[change.authorization_state] : null],
    ['Terminauswirkung', change?.schedule_impact],
  ];
  const measurementTable = measurementLines.length ? `<table><thead><tr><th>Position</th><th>Ort</th><th>Menge</th><th>Einheit</th><th>Hinweis</th></tr></thead><tbody>${measurementLines.map((line) => `<tr><td>${escapeHtml(line.description)}</td><td>${escapeHtml(line.location)}</td><td>${escapeHtml(line.quantity)}</td><td>${escapeHtml(WORK_ARTIFACT_UNIT_LABELS[line.unit])}</td><td>${escapeHtml(line.note)}</td></tr>`).join('')}</tbody></table>` : '';
  const actionTable = actions.length ? `<h2>Entscheidungen und Bestätigungen</h2><table><thead><tr><th>Zeitpunkt</th><th>Aktion</th><th>Name</th><th>Grund/Hinweis</th></tr></thead><tbody>${actions.map((action) => `<tr><td>${escapeHtml(action.created_at)}</td><td>${escapeHtml(ACTION_LABELS[action.action_type])}</td><td>${escapeHtml(action.signer_name)}</td><td>${escapeHtml(action.reason ?? action.comment)}</td></tr>`).join('')}</tbody></table>` : '';
  const documentTable = documents.length ? `<h2>Verknüpfte Dokumente</h2><table><thead><tr><th>Bezug</th><th>Beschreibung</th><th>Dokument-ID</th></tr></thead><tbody>${documents.map((document) => `<tr><td>${escapeHtml(DOCUMENT_RELATION_LABELS[document.relation])}</td><td>${escapeHtml(document.description)}</td><td>${escapeHtml(document.document_id)}</td></tr>`).join('')}</tbody></table>` : '';
  const sourceTable = sources.length ? `<h2>Quellen</h2><table><thead><tr><th>Art</th><th>Beschreibung</th><th>Quell-ID</th></tr></thead><tbody>${sources.map((source) => `<tr><td>${source.time_entry_id ? 'Zeiteintrag' : 'Bestandsbewegung'}</td><td>${escapeHtml(source.description)}</td><td>${escapeHtml(source.time_entry_id ?? source.inventory_movement_id)}</td></tr>`).join('')}</tbody></table>` : '';
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${escapeHtml(revision.title)}</title><style>@page{size:A4;margin:18mm}body{font:14px/1.5 system-ui,sans-serif;color:#222;max-width:180mm;margin:auto}header{border-bottom:2px solid #ff7900;margin-bottom:20px}h1{font-size:24px}h2{font-size:12px;text-transform:uppercase;color:#666;margin:18px 0 4px}p{white-space:pre-wrap;margin:0}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border:1px solid #bbb;padding:6px;text-align:left;vertical-align:top}.meta{font:11px ui-monospace,monospace;color:#555;overflow-wrap:anywhere}</style></head><body><header><h1>${escapeHtml(revision.title)}</h1><p class="meta">Artefakt ${escapeHtml(artifact.id)} · Revision ${revision.revision_number} (${escapeHtml(revision.id)}) · Status ${escapeHtml(artifact.status)} · Renderer ${WORK_ARTIFACT_EXPORT_RENDERER_VERSION} · Inhalts-Hash ${contentHash}</p></header>${rows(fields)}${measurementTable}${actionTable}${documentTable}${sourceTable}</body></html>`;
  return {
    html, bytes: Buffer.from(html, 'utf8'), contentHash,
    rendererVersion: WORK_ARTIFACT_EXPORT_RENDERER_VERSION,
    fileName: `Arbeitsnachweis-${artifact.id.slice(0, 8)}-V${revision.revision_number}-${contentHash.slice(0, 8)}.html`,
  };
}
