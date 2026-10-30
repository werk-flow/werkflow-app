import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { newRunSalt, type ColumnProfile } from './column-statistics';
import { datanormTables } from './datanorm';
import { delimitedRows, detectDelimiter, hasUnquotedDelimiter, type Delimiter } from './delimited-text';
import { DocumentInventory, type DocumentGroup, type FolderShape } from './document-inventory';
import { readWorkbook } from './excel-workbook';
import { categorize, extensionLabel, readHead, walkExportFolder, type ExportFile } from './export-files';
import { exportLabel } from './personal-data';
import { findRelations, type Relation, type TableColumns } from './relations';
import { buildNamedTables, buildRowTable, type BuiltTable, type HeaderMode } from './table-builder';
import { decodeText } from './text-decoding';
import { declaredXmlEncoding, xmlRecords } from './xml-records';
import { ExportFormatError, type ExportFormatCode } from './zip-archive';

// Profiles an export folder into a structure-only description. Every name
// from the export passes through exportLabel; every value stays in memory.

export type TableProfile = {
  file: string;
  table: string | null;
  format: 'delimited' | 'excel' | 'xml' | 'datanorm';
  encoding: string | null;
  delimiter: string | null;
  header: HeaderMode;
  rows: number;
  raggedRows: number;
  note: string | null;
  columns: ColumnProfile[];
};

type BinaryFileProfile = { file: string; bytes: number; format: string; toRead: string };

export type ExportProfile = {
  files: {
    total: number;
    bytes: number;
    tableFiles: number;
    binaries: number;
    documents: number;
    photos: number;
    other: number;
  };
  wrapperFolders: number;
  skippedSystemFiles: number;
  tables: TableProfile[];
  relations: Relation[];
  binaries: BinaryFileProfile[];
  documents: DocumentGroup[];
  folders: FolderShape[];
  otherFiles: { extension: string; files: number; bytes: number }[];
  unreadable: UnreadableFile[];
};

type UnreadableFile = { file: string; reason: string; advice: string };

type ProfileOptions = { maskLabels: boolean };

const RESAVE =
  'Open it in Excel or LibreOffice Calc, save it again as .xlsx or each sheet as CSV, then run the profiler again.';

/** A fixed instruction per refusal; a parser message never reaches the profile. */
const UNREADABLE_ADVICE: Record<ExportFormatCode, string> = {
  not_a_zip_archive: RESAVE,
  xlsx_workbook_missing: RESAVE,
  xlsx_sheet_missing: RESAVE,
  delimiter_ambiguous:
    'The separator cannot be told apart: ask Willert which separator the export uses (or export it again). If the file is otherwise intact, add that separator as the first line, such as sep=;, then run the profiler again.',
  zip_directory_damaged: RESAVE,
  zip_entry_damaged: RESAVE,
  zip_method_unsupported: RESAVE,
  zip64_unsupported:
    'The workbook is too large for this reader: save each sheet as CSV, then run the profiler again.',
  zip_entry_encrypted:
    'The workbook is password-protected: remove the password in Excel, save it as .xlsx, then run the profiler again.',
  delimited_quote_unclosed:
    'A quoted field never closes, so the rows cannot be told apart: export the file again or open it in LibreOffice Calc and save it as CSV.',
  xml_not_well_formed: 'The XML file is damaged or incomplete: ask Willert for a fresh export of it.',
};
const UNEXPECTED_ADVICE =
  'Check that the file opens on this Mac and that you may read it, then run the profiler again.';

type Collected = { profile: TableProfile; built: BuiltTable };

type Run = {
  options: ProfileOptions;
  salt: Uint8Array;
  tables: Collected[];
  binaries: BinaryFileProfile[];
  inventory: DocumentInventory;
  other: Map<string, { files: number; bytes: number }>;
  unreadable: UnreadableFile[];
  counts: { tableFiles: number; binaries: number; documents: number; photos: number; other: number };
};

/** Profiles every file below `root`. */
export function profileExportFolder(root: string, options: ProfileOptions): ExportProfile {
  const { files, skippedSystemFiles } = walkExportFolder(root);
  const wrapperFolders = sharedFolderDepth(files);
  const run: Run = {
    options,
    salt: newRunSalt(),
    tables: [],
    binaries: [],
    inventory: new DocumentInventory(),
    other: new Map(),
    unreadable: [],
    counts: { tableFiles: 0, binaries: 0, documents: 0, photos: 0, other: 0 },
  };
  for (const file of files) profileFile(run, file, file.segments.slice(wrapperFolders));
  return {
    files: { total: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0), ...run.counts },
    wrapperFolders,
    skippedSystemFiles,
    tables: run.tables.map((table) => table.profile),
    relations: findRelations(run.tables.map((table, index) => relationColumns(table, index))),
    binaries: run.binaries,
    documents: run.inventory.documentGroups(),
    folders: run.inventory.folderShapes(),
    otherFiles: [...run.other].map(([extension, group]) => ({ extension, ...group })),
    unreadable: run.unreadable,
  };
}

/** The number of leading folders every file shares, such as one wrapper folder around the export. */
function sharedFolderDepth(files: readonly ExportFile[]): number {
  const [first, ...rest] = files;
  if (!first) return 0;
  let depth = first.segments.length - 1;
  for (const file of rest) {
    let shared = 0;
    while (
      shared < Math.min(depth, file.segments.length - 1) &&
      file.segments[shared] === first.segments[shared]
    )
      shared += 1;
    depth = shared;
  }
  return depth;
}

function profileFile(run: Run, file: ExportFile, segments: readonly string[]): void {
  const name = segments.at(-1) ?? '';
  const label = segments.map((segment) => exportLabel(segment, run.options.maskLabels)).join('/');
  try {
    const category = categorize(name, readHead(file.path));
    switch (category.kind) {
      case 'delimited':
        return profileDelimited(run, file, label, segments);
      case 'excel':
        return profileWorkbook(run, file, label);
      case 'xml':
        return profileXml(run, file, label);
      case 'datanorm':
        return profileDatanorm(run, file, label);
      case 'document':
      case 'photo':
        return countDocument(run, file, category.kind, segments);
      case 'binary':
        run.counts.binaries += 1;
        run.binaries.push({
          file: label,
          bytes: file.bytes,
          format: category.format,
          toRead: category.toRead,
        });
        return;
      case 'other':
        return addOther(run, file, name);
    }
  } catch (error) {
    run.unreadable.push(
      error instanceof ExportFormatError
        ? { file: label, reason: error.code, advice: UNREADABLE_ADVICE[error.code] }
        : { file: label, reason: `${errorName(error)} while reading`, advice: UNEXPECTED_ADVICE },
    );
  }
}

/** The error's name and system code (EACCES), never its message: a file system message quotes the path. */
function errorName(error: unknown): string {
  if (!(error instanceof Error)) return 'error';
  return 'code' in error && typeof error.code === 'string' ? `${error.name} ${error.code}` : error.name;
}

function countDocument(
  run: Run,
  file: ExportFile,
  kind: 'document' | 'photo',
  segments: readonly string[],
): void {
  run.counts[kind === 'document' ? 'documents' : 'photos'] += 1;
  const folder = segments.length > 1 ? exportLabel(segments[0] ?? '', run.options.maskLabels) : '(top level)';
  const name = segments.at(-1) ?? '';
  const extension = extensionLabel(name);
  const isPdf = extname(name).toLowerCase() === '.pdf';
  run.inventory.add(
    { path: file.path, bytes: file.bytes, extension, isPdf },
    kind,
    folder,
    segments.slice(1, -1),
  );
}

function addOther(run: Run, file: ExportFile, name: string): void {
  run.counts.other += 1;
  const extension = extensionLabel(name);
  const group = run.other.get(extension) ?? { files: 0, bytes: 0 };
  run.other.set(extension, { files: group.files + 1, bytes: group.bytes + file.bytes });
}

type TableSource = Omit<TableProfile, 'header' | 'rows' | 'raggedRows' | 'columns'>;

function addTable(run: Run, source: TableSource, built: BuiltTable): void {
  const columns = built.columns.map((column) => {
    const profile = column.profile(built.rows);
    return { ...profile, name: exportLabel(profile.name, run.options.maskLabels) };
  });
  run.tables.push({
    profile: { ...source, header: built.header, rows: built.rows, raggedRows: built.raggedRows, columns },
    built,
  });
}

/**
 * A .csv or .tsv without a consistent delimiter is one column only when it
 * holds no delimiter character outside quotes; otherwise the separator is
 * ambiguous. Any other text file without one is a document.
 */
function singleColumnTable(path: string, text: string): Delimiter | null {
  const extension = extname(path).toLowerCase();
  if (extension !== '.csv' && extension !== '.tsv') return null;
  if (hasUnquotedDelimiter(text)) throw new ExportFormatError('delimiter_ambiguous');
  return extension === '.tsv' ? '\t' : ';';
}

function profileDelimited(run: Run, file: ExportFile, label: string, segments: readonly string[]): void {
  const decoded = decodeText(readFileSync(file.path));
  const delimiter = detectDelimiter(decoded.text) ?? singleColumnTable(file.path, decoded.text);
  if (delimiter === null) return countDocument(run, file, 'document', segments);
  const rows = (function* () {
    for (const row of delimitedRows(decoded.text, delimiter)) yield row.map((text) => ({ text }));
  })();
  const built = buildRowTable(rows, { salt: run.salt, detectHeader: true });
  run.counts.tableFiles += 1;
  const shownDelimiter = delimiter === '\t' ? 'tab' : delimiter;
  addTable(
    run,
    {
      file: label,
      table: null,
      format: 'delimited',
      encoding: decoded.encoding,
      delimiter: shownDelimiter,
      note: null,
    },
    built,
  );
}

function profileWorkbook(run: Run, file: ExportFile, label: string): void {
  // Every sheet is read before the first table is added, so a damaged workbook adds nothing.
  const sheets = readWorkbook(readFileSync(file.path)).map((sheet) => ({
    name: sheet.name,
    built: buildRowTable(sheet.rows(), { salt: run.salt, detectHeader: true }),
  }));
  for (const { name, built } of sheets) {
    const table = exportLabel(name, run.options.maskLabels);
    addTable(
      run,
      { file: label, table, format: 'excel', encoding: null, delimiter: null, note: null },
      built,
    );
  }
  run.counts.tableFiles += 1;
}

function profileXml(run: Run, file: ExportFile, label: string): void {
  const bytes = readFileSync(file.path);
  const declared = declaredXmlEncoding(new TextDecoder('latin1').decode(bytes.subarray(0, 200)));
  const latin = declared !== null && /^(?:iso-8859-1|iso-8859-15|latin1|windows-1252|cp1252)$/.test(declared);
  const decoded = latin
    ? { encoding: 'windows-1252', text: new TextDecoder('windows-1252').decode(bytes) }
    : decodeText(bytes);
  // Every record is read before the first table is added, so a damaged file adds nothing.
  for (const [path, built] of buildNamedTables(xmlRecords(decoded.text), run.salt)) {
    const table = path
      .split('/')
      .map((segment) => exportLabel(segment, run.options.maskLabels))
      .join('/');
    addTable(
      run,
      { file: label, table, format: 'xml', encoding: decoded.encoding, delimiter: null, note: null },
      built,
    );
  }
  run.counts.tableFiles += 1;
}

function profileDatanorm(run: Run, file: ExportFile, label: string): void {
  const decoded = decodeText(readFileSync(file.path));
  const tables = datanormTables(decoded.text, run.salt);
  run.counts.tableFiles += 1;
  for (const { recordType, fixedWidth, table } of tables) {
    const note = fixedWidth
      ? 'fixed-width lines (DATANORM 3): reading the fields needs the DATANORM 3 field layout'
      : null;
    const source: TableSource = {
      file: label,
      table: `record type ${recordType}`,
      format: 'datanorm',
      encoding: decoded.encoding,
      delimiter: fixedWidth ? null : ';',
      note,
    };
    addTable(run, source, table);
  }
}

function relationColumns({ profile, built }: Collected, id: number): TableColumns {
  return {
    id,
    table: profile.table === null ? profile.file : `${profile.file} › ${profile.table}`,
    columns: built.columns.map((accumulator, index) => {
      const column = profile.columns[index];
      return {
        label: column?.name ?? accumulator.name,
        accumulator,
        type: column?.type ?? 'empty',
        keyLike: column?.keyLike ?? false,
        maxLength: column?.maxLength ?? null,
      };
    }),
  };
}
