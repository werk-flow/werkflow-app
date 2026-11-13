import {
  DOCUMENT_CATEGORY_LABELS,
  DOCUMENT_RETENTION_CLASS_LABELS,
  toDocumentCategory,
} from '@/lib/documents/types';
import type { Tables } from '@/lib/supabase/database.types';
import { getFolderPath } from '@/lib/documents/folder-tree';
import type { DocumentArchiveRows } from './documents';

// The document manifest of an organization export: one row per document
// whose files the export holds (the company profile's logo and stationery
// belong to none), with its folder path, links, category,
// document date, retention, filed state, origin and every version's place in
// the archive.

/** A planned file with the number of the part that holds it. */
export type ManifestFile = Pick<
  Tables<'organization_export_files'>,
  'document_id' | 'version_number' | 'archive_name' | 'file_bytes'
> & { partNumber: number };

const LINK_KINDS = [
  ['job_id', 'Auftrag'],
  ['project_id', 'Projekt'],
  ['client_id', 'Kunde'],
  ['employee_id', 'Mitarbeiter'],
  ['request_id', 'Anfrage'],
  ['equipment_id', 'Anlage'],
  ['service_case_id', 'Servicefall'],
  ['maintenance_coverage_id', 'Wartungsvertrag'],
] as const satisfies readonly (readonly [keyof Tables<'document_links'>, string])[];

const PERSONNEL_CLASS_LABELS: Record<Tables<'personnel_documents'>['access_class'], string> = {
  personnel_standard: 'Personalakte',
  admin_restricted: 'Personalakte, nur Admin',
  health_evidence: 'Gesundheitsnachweis',
};

export const MANIFEST_HEADERS = [
  'Dokument-ID',
  'Name',
  'Ordnerpfad',
  'Kategorie',
  'Belegdatum',
  'Aufbewahrungsklasse',
  'Aufbewahrung bis',
  'Festgeschrieben am',
  'Herkunftssystem',
  'Alte Nummer',
  'Im Papierkorb',
  'Personalakte',
  'Verknüpfungen',
  'Version im Export',
  'Datei im Export',
  'Exportteil',
  'Größe (Bytes)',
  'Frühere Versionen',
  'Hinweis',
] as const;

type ManifestRow = readonly (string | number)[];

/**
 * The manifest rows, in archive-name order of each document's current file.
 * `recordLabels` names a linked record by id, such as „Auftrag A-100“.
 */
export function buildDocumentManifest(
  archive: DocumentArchiveRows,
  files: readonly ManifestFile[],
  recordLabels: ReadonlyMap<string, string>,
): ManifestRow[] {
  const documents = new Map(archive.documents.map((document) => [document.id, document]));
  const linksByDocument = new Map<string, Tables<'document_links'>[]>();
  for (const link of archive.links) {
    const links = linksByDocument.get(link.document_id);
    if (links) links.push(link);
    else linksByDocument.set(link.document_id, [link]);
  }
  const filesByDocument = new Map<string, ManifestFile[]>();
  for (const file of files) {
    // A file of the company document profile belongs to no document.
    if (file.document_id === null) continue;
    const documentFiles = filesByDocument.get(file.document_id);
    if (documentFiles) documentFiles.push(file);
    else filesByDocument.set(file.document_id, [file]);
  }

  const rows = [...filesByDocument].map(([documentId, documentFiles]) => {
    const current = documentFiles.find((file) => file.version_number === null);
    const earlier = documentFiles
      .filter((file) => file.version_number !== null)
      .sort((left, right) => (left.version_number ?? 0) - (right.version_number ?? 0));
    const document = documents.get(documentId);
    const links = (linksByDocument.get(documentId) ?? []).flatMap((link) =>
      LINK_KINDS.flatMap(([column, kind]) => {
        const id = link[column];
        return id ? [recordLabels.get(id) ?? `${kind} ${id}`] : [];
      }),
    );
    // Versions are numbered from 1, so the current file at the start was the one after the earlier ones.
    const plannedVersion = earlier.length + 1;
    const sortKey = current?.archive_name ?? earlier[0]?.archive_name ?? documentId;
    const row: ManifestRow = [
      documentId,
      document?.display_name ?? '',
      document
        ? getFolderPath(archive.folders, document.folder_id)
            .map((folder) => folder.name)
            .join(' / ')
        : '',
      document ? DOCUMENT_CATEGORY_LABELS[toDocumentCategory(document.category)] : '',
      document?.document_date ?? '',
      document?.retention_class ? DOCUMENT_RETENTION_CLASS_LABELS[document.retention_class] : '',
      document?.retention_ends_on ?? '',
      document?.filed_at ?? '',
      document?.source_system ?? '',
      document?.source_reference ?? '',
      document ? (document.deleted_at ? 'ja' : 'nein') : '',
      (() => {
        const accessClass = archive.personnelClasses.get(documentId);
        return accessClass ? PERSONNEL_CLASS_LABELS[accessClass] : '';
      })(),
      [...new Set(links)].sort().join('; '),
      plannedVersion,
      current?.archive_name ?? '',
      current?.partNumber ?? '',
      current?.file_bytes ?? '',
      earlier
        .map((file) => `Version ${file.version_number}: Teil ${file.partNumber}, ${file.archive_name}`)
        .join('; '),
      changeNote(document, plannedVersion),
    ];
    return { sortKey, row };
  });
  return rows
    .sort((left, right) => (left.sortKey < right.sortKey ? -1 : left.sortKey > right.sortKey ? 1 : 0))
    .map(({ row }) => row);
}

/**
 * The note on a document that changed after the export started: its rows
 * describe it as it is now, its files are those of the start.
 */
function changeNote(document: Tables<'documents'> | undefined, plannedVersion: number): string {
  if (!document) return 'Nach dem Start des Exports endgültig gelöscht';
  if (document.current_version_number !== plannedVersion)
    return `Nach dem Start des Exports neue Version ${document.current_version_number}, nicht im Export`;
  return '';
}

type JsonRow = Readonly<Record<string, unknown>>;

function textField(row: JsonRow, column: string): string {
  const value = row[column];
  return typeof value === 'string' ? value : '';
}

const LABELED_TABLES: readonly (readonly [string, string, (row: JsonRow) => string])[] = [
  [
    'jobs',
    'Auftrag',
    (row) => [textField(row, 'job_number'), textField(row, 'title')].filter(Boolean).join(' '),
  ],
  [
    'projects',
    'Projekt',
    (row) => [textField(row, 'project_number'), textField(row, 'title')].filter(Boolean).join(' '),
  ],
  [
    'clients',
    'Kunde',
    (row) => [textField(row, 'customer_number'), textField(row, 'name')].filter(Boolean).join(' '),
  ],
  [
    'employee_records',
    'Mitarbeiter',
    (row) => [textField(row, 'first_name'), textField(row, 'last_name')].filter(Boolean).join(' '),
  ],
  [
    'client_requests',
    'Anfrage',
    (row) => [textField(row, 'request_number'), textField(row, 'summary')].filter(Boolean).join(' '),
  ],
  [
    'installed_equipment',
    'Anlage',
    (row) => [textField(row, 'equipment_number'), textField(row, 'name')].filter(Boolean).join(' '),
  ],
  [
    'service_cases',
    'Servicefall',
    (row) => [textField(row, 'case_number'), textField(row, 'title')].filter(Boolean).join(' '),
  ],
  ['maintenance_coverages', 'Wartungsvertrag', (row) => textField(row, 'coverage_number')],
];

/** Readable names of the records a document can link to, by id, from the exported rows. */
export function linkedRecordLabels(
  rowsByTable: ReadonlyMap<string, readonly JsonRow[]>,
): Map<string, string> {
  const labels = new Map<string, string>();
  for (const [table, kind, describe] of LABELED_TABLES) {
    for (const row of rowsByTable.get(table) ?? []) {
      const id = textField(row, 'id');
      const description = describe(row);
      if (id) labels.set(id, description ? `${kind} ${description}` : `${kind} ${id}`);
    }
  }
  return labels;
}
