import 'server-only';

import { buildCsv } from '@/lib/format/csv-zip';
import type { AdminClient } from '@/lib/supabase/admin';
import { isJsonRecord, toJson } from '@/lib/supabase/json';
import { mapInWindows, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { EXPORT_TABLES, exportedColumns, TABLE_FILES, type ExportTable } from './columns';
import { EXPORT_ROW_CAP, readDocumentArchive } from './documents';
import { PART_BYTE_LIMIT, PART_FILE_LIMIT } from './plan';
import { formatFileSize } from '@/lib/documents/format';
import { buildDocumentManifest, linkedRecordLabels, MANIFEST_HEADERS, type ManifestFile } from './manifest';

// The data part of an organization export: every record of the organization
// as one CSV file per table, the document manifest, the column dictionary
// and a README. Every read filters on the organization.

const PAGE_SIZE = 2_000;
const encoder = new TextEncoder();

type JsonRow = Record<string, unknown>;

/** A CSV cell: empty for null, ja or nein for a boolean, JSON for an object. */
function exportCell(value: unknown): string | number {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'ja' : 'nein';
  if (typeof value === 'number' || typeof value === 'string') return value;
  return JSON.stringify(value);
}

type TableRows = { columns: string[]; rows: JsonRow[] };

function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.flatMap((item) => (typeof item === 'string' ? [item] : [])) : [];
}

/** One page of a table's rows after the row `after`, with the table's columns. */
async function readPage(
  admin: AdminClient,
  organizationId: string,
  table: string,
  after: JsonRow | null,
): Promise<TableRows> {
  const { data, error } = await admin.rpc(
    'read_organization_export_page',
    rpcArgs('read_organization_export_page', {
      p_organization_id: organizationId,
      p_table: table,
      p_after: after === null ? null : toJson(after),
      p_limit: PAGE_SIZE,
    }),
  );
  if (error || !isJsonRecord(data) || !Array.isArray(data.rows)) throw new Error('load_failed');
  return {
    columns: textList(data.columns),
    rows: data.rows.flatMap((row) => (isJsonRecord(row) ? [row] : [])),
  };
}

/** Every row of a table that has `organization_id`, page by page in primary-key order. */
async function readOrganizationRows(
  admin: AdminClient,
  organizationId: string,
  table: string,
): Promise<TableRows> {
  const rows: JsonRow[] = [];
  let columns: string[] = [];
  for (let after: JsonRow | null = null; ; ) {
    const page = await readPage(admin, organizationId, table, after);
    columns = page.columns;
    rows.push(...page.rows);
    if (rows.length > EXPORT_ROW_CAP) throw new Error('export_too_large');
    const last = page.rows.at(-1);
    if (page.rows.length < PAGE_SIZE || last === undefined) return { columns, rows };
    after = last;
  }
}

/** The organization row, or the profiles of the organization's members. */
async function readGlobalRows(
  admin: AdminClient,
  organizationId: string,
  table: ExportTable,
): Promise<TableRows> {
  const rows = await readGlobalRowList(admin, organizationId, table);
  return { columns: Object.keys(rows[0] ?? {}), rows };
}

async function readGlobalRowList(
  admin: AdminClient,
  organizationId: string,
  table: ExportTable,
): Promise<JsonRow[]> {
  if (table === 'organizations') {
    const { data, error } = await admin.from('organizations').select('*').eq('id', organizationId);
    if (error) throw new Error('load_failed');
    return data;
  }
  const members = await readCompleteRows(
    (from, to) =>
      admin
        .from('organization_members')
        .select('user_id')
        .eq('organization_id', organizationId)
        .order('id')
        .range(from, to),
    EXPORT_ROW_CAP,
  );
  if (members.error) throw new Error('load_failed');
  const profiles = await readInBatches(
    members.data.map((member) => member.user_id),
    (ids) =>
      admin
        .from('profiles')
        .select('*')
        .in('id', [...ids]),
  );
  if (profiles.error) throw new Error('load_failed');
  return profiles.data;
}

/** The planned files of the export with the number of the part that holds each. */
async function readManifestFiles(
  admin: AdminClient,
  organizationId: string,
  exportId: string,
): Promise<ManifestFile[]> {
  const [parts, files] = await Promise.all([
    readCompleteRows(
      (from, to) =>
        admin
          .from('organization_export_parts')
          .select('id, part_number')
          .eq('organization_id', organizationId)
          .eq('export_id', exportId)
          .order('part_number')
          .range(from, to),
      EXPORT_ROW_CAP,
    ),
    readCompleteRows(
      (from, to) =>
        admin
          .from('organization_export_files')
          .select('document_id, version_number, archive_name, file_bytes, part_id')
          .eq('organization_id', organizationId)
          .eq('export_id', exportId)
          .order('id')
          .range(from, to),
      EXPORT_ROW_CAP,
    ),
  ]);
  if (parts.error || files.error) throw new Error('load_failed');
  const partNumbers = new Map(parts.data.map((part) => [part.id, part.part_number]));
  return files.data.map((file) => ({ ...file, partNumber: partNumbers.get(file.part_id) ?? 0 }));
}

/** How the export splits into parts: one part holds only data, more parts hold the originals too. */
function partLines(partCount: number): string[] {
  if (partCount === 1)
    return [
      'Der Export besteht aus diesem einen Archiv mit allen Daten; beim Start gab es keine Originaldateien.',
    ];
  return [
    `Der Export besteht aus ${partCount} Teilen. Teil 1 (dieses Archiv) enthält alle Daten,`,
    'die weiteren Teile enthalten die Originaldateien im Ordner „Dateien“, nach Ordnern sortiert,',
    `höchstens ${PART_FILE_LIMIT.toLocaleString('de-DE')} Dateien oder ${formatFileSize(PART_BYTE_LIMIT)} je Teil.`,
    'Personalakten liegen unter „Dateien/Personalakten“, Dateien aus dem Papierkorb unter',
    '„Dateien/Papierkorb“. Frühere Versionen tragen „(Version n)“ im Namen.',
  ];
}

function readme(input: { organizationName: string; generatedAt: string; partCount: number }): string {
  return [
    `WerkFlow-Datenexport: ${input.organizationName}`,
    `Erstellt: ${input.generatedAt}`,
    '',
    ...partLines(input.partCount),
    '',
    '„Dokumentenverzeichnis.csv“ nennt jedes Dokument einmal: Ordnerpfad, Kategorie, Belegdatum,',
    'Aufbewahrung, Festschreibung, Herkunft, Verknüpfungen und für jede Version die Datei im',
    'Export und den Teil, der sie enthält.',
    '',
    'Der Ordner „Daten“ enthält jeden Datensatz der Organisation, eine CSV-Datei je Bereich.',
    '„Spaltenverzeichnis.csv“ nennt zu jeder Spalte die Datei und den technischen Namen.',
    'IDs verbinden die Dateien untereinander, zum Beispiel „Kunde-ID“ mit der „ID“ in „Kunden.csv“.',
    '',
    'Format: UTF-8 mit BOM, Trennzeichen Semikolon, Zeilenende CRLF, so öffnet Excel die Dateien',
    'direkt. Zeitpunkte stehen in UTC (ISO 8601), Datumsangaben als JJJJ-MM-TT. Ein Wert, der',
    'mit =, +, -, @ beginnt, steht mit einem vorangestellten Apostroph in der Datei.',
    '',
    'Nicht enthalten: Beitritts- und Einladungscodes, Anmeldecodes, technische Zwischenstände und',
    'die Datei- und Teillisten früherer Exporte. Wer wann exportiert und heruntergeladen hat, steht',
    'in „Daten/Datenexporte.csv“ und „Daten/Datenexporte_Protokoll.csv“.',
    '',
    'Die Originaldateien sind die vom Start dieses Exports. Wurde ein Dokument danach endgültig',
    'gelöscht oder bekam es eine neue Version, nennt das die Spalte „Hinweis“ im',
    'Dokumentenverzeichnis, sofern es vor der Erstellung dieses Archivs geschah. Ein Dokument, das',
    'nach dem Start hochgeladen wurde, steht nur in „Daten/Dokumente.csv“. Den Stand nach späteren',
    'Änderungen enthält ein neuer Export.',
    '',
  ].join('\r\n');
}

/** The files of the data part's archive, by name. */
export async function buildDataPartFiles(
  admin: AdminClient,
  context: { organizationId: string; exportId: string; partCount: number },
): Promise<Record<string, Uint8Array>> {
  const { organizationId, exportId } = context;
  const read = await mapInWindows(
    EXPORT_TABLES,
    async (table) => {
      const { columns, rows } =
        table === 'organizations' || table === 'profiles'
          ? await readGlobalRows(admin, organizationId, table)
          : await readOrganizationRows(admin, organizationId, table);
      return { table, columns: exportedColumns(table, columns), rows };
    },
    () => false,
  );
  const rowsByTable = new Map(read.map(({ table, rows }) => [table, rows]));

  const files: Record<string, Uint8Array> = {};
  const dictionary: (readonly string[])[] = [];
  for (const { table, columns, rows } of read) {
    const fileName = `Daten/${TABLE_FILES[table]}.csv`;
    files[fileName] = buildCsv(
      columns.map((column) => column.label),
      rows.map((row) => columns.map((column) => exportCell(row[column.column]))),
    );
    for (const column of columns) dictionary.push([fileName, column.label, `${table}.${column.column}`]);
  }

  const [archive, manifestFiles] = await Promise.all([
    readDocumentArchive(admin, organizationId),
    readManifestFiles(admin, organizationId, exportId),
  ]);
  files['Dokumentenverzeichnis.csv'] = buildCsv(
    MANIFEST_HEADERS,
    buildDocumentManifest(archive, manifestFiles, linkedRecordLabels(rowsByTable)),
  );
  files['Spaltenverzeichnis.csv'] = buildCsv(['Datei', 'Spalte', 'Technischer Name'], dictionary);
  const organization = rowsByTable.get('organizations')?.[0];
  files['LIESMICH.txt'] = encoder.encode(
    readme({
      organizationName: typeof organization?.name === 'string' ? organization.name : '',
      generatedAt: new Date().toISOString(),
      partCount: context.partCount,
    }),
  );
  return files;
}
