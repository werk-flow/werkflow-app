import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { newRunSalt, type ColumnProfile } from './column-statistics';
import { datanormTables } from './datanorm';
import { delimitedRows, detectDelimiter } from './delimited-text';
import { DocumentInventory, type DocumentGroup, type FolderShape } from './document-inventory';
import { readWorkbook } from './excel-workbook';
import { categorize, readHead, walkExportFolder, type ExportFile } from './export-files';
import { exportLabel } from './personal-data';
import { findRelations, type Relation, type TableColumns } from './relations';
import { buildNamedTables, buildRowTable, type BuiltTable, type HeaderMode } from './table-builder';
import { decodeText } from './text-decoding';
import { declaredXmlEncoding, xmlRecords } from './xml-records';
import { ExportFormatError } from './zip-archive';

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
  unreadable: { file: string; reason: string }[];
};

type ProfileOptions = { maskLabels: boolean };

type Collected = { profile: TableProfile; built: BuiltTable };

type Run = {
  options: ProfileOptions;
  salt: Uint8Array;
  tables: Collected[];
  binaries: BinaryFileProfile[];
  inventory: DocumentInventory;
  other: Map<string, { files: number; bytes: number }>;
  unreadable: { file: string; reason: string }[];
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
    relations: findRelations(run.tables.map(relationColumns)),
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
    run.unreadable.push({
      file: label,
      reason: error instanceof ExportFormatError ? error.code : `${errorName(error)} while reading`,
    });
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
  run.inventory.add({ name, path: file.path, bytes: file.bytes }, kind, folder, segments.slice(1, -1));
}

function addOther(run: Run, file: ExportFile, name: string): void {
  run.counts.other += 1;
  const extension = exportLabel(extname(name).toLowerCase() || '(none)', run.options.maskLabels);
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

function profileDelimited(run: Run, file: ExportFile, label: string, segments: readonly string[]): void {
  const decoded = decodeText(readFileSync(file.path));
  const delimiter =
    detectDelimiter(decoded.text) ?? (extname(file.path).toLowerCase() === '.csv' ? ';' : null);
  if (delimiter === null) return countDocument(run, file, 'document', segments);
  run.counts.tableFiles += 1;
  const rows = (function* () {
    for (const row of delimitedRows(decoded.text, delimiter)) yield row.map((text) => ({ text }));
  })();
  const built = buildRowTable(rows, { salt: run.salt, detectHeader: true });
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
  run.counts.tableFiles += 1;
  for (const sheet of readWorkbook(readFileSync(file.path))) {
    const built = buildRowTable(sheet.rows(), { salt: run.salt, detectHeader: true });
    const table = exportLabel(sheet.name, run.options.maskLabels);
    addTable(
      run,
      { file: label, table, format: 'excel', encoding: null, delimiter: null, note: null },
      built,
    );
  }
}

function profileXml(run: Run, file: ExportFile, label: string): void {
  run.counts.tableFiles += 1;
  const bytes = readFileSync(file.path);
  const declared = declaredXmlEncoding(new TextDecoder('latin1').decode(bytes.subarray(0, 200)));
  const latin = declared !== null && /^(?:iso-8859-1|iso-8859-15|latin1|windows-1252|cp1252)$/.test(declared);
  const decoded = latin
    ? { encoding: 'windows-1252', text: new TextDecoder('windows-1252').decode(bytes) }
    : decodeText(bytes);
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
}

function profileDatanorm(run: Run, file: ExportFile, label: string): void {
  run.counts.tableFiles += 1;
  const decoded = decodeText(readFileSync(file.path));
  for (const { recordType, fixedWidth, table } of datanormTables(decoded.text, run.salt)) {
    const note = fixedWidth
      ? 'fixed-width lines (DATANORM 3): reading the fields needs the DATANORM 3 field layout'
      : null;
    const source: TableSource = {
      file: label,
      table: `record type ${exportLabel(recordType, run.options.maskLabels)}`,
      format: 'datanorm',
      encoding: decoded.encoding,
      delimiter: fixedWidth ? null : ';',
      note,
    };
    addTable(run, source, table);
  }
}

function relationColumns({ profile, built }: Collected): TableColumns {
  return {
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
