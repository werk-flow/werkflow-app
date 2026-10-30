import type { ColumnProfile } from './column-statistics';
import type { ExportProfile, TableProfile } from './profile-export';

// Renders the profile as profile.md for people and profile.json for tools.
// Both carry only what ExportProfile holds: labels, counts, types, lengths,
// masked shapes and year ranges.

export type ProfileReport = { markdown: string; json: string };

/** The two output files of one profile. */
export function renderProfile(profile: ExportProfile, generatedOn: string): ProfileReport {
  return {
    markdown: renderMarkdown(profile, generatedOn),
    json: `${JSON.stringify({ generatedOn, ...profile }, null, 2)}\n`,
  };
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
}

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  if (rows.length === 0) return '_None._\n';
  const lines = [header, header.map(() => '---'), ...rows].map((row) => `| ${row.map(cell).join(' | ')} |`);
  return `${lines.join('\n')}\n`;
}

/** A byte count for people: B, KB, MB or GB. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit] ?? 'TB'}`;
}

function percent(rate: number): string {
  return `${Math.round(rate * 1000) / 10} %`;
}

function renderMarkdown(profile: ExportProfile, generatedOn: string): string {
  return [
    '# Export profile\n',
    `Generated on ${generatedOn}. Structure only: no value from the export appears here.`,
    'Shapes replace each uppercase letter with X, each other letter with x and each digit with 9. Dates appear only as year ranges.\n',
    overviewSection(profile),
    '## Tables\n',
    profile.tables.length === 0 ? '_None._\n' : profile.tables.map(renderTable).join('\n'),
    '## Relations\n',
    'A key-like column, and the columns of other tables whose distinct values mostly appear in it. Compared as salted hashes in memory.\n',
    table(
      ['Key column', 'Referenced by', 'Shared distinct values', 'Coverage', 'Note'],
      profile.relations.map((relation) => [
        `${relation.key.table} › ${relation.key.column}`,
        `${relation.referencedBy.table} › ${relation.referencedBy.column}`,
        `${relation.sharedValues}`,
        percent(relation.coverage),
        relation.note ?? '',
      ]),
    ),
    '## Database and binary files\n',
    table(
      ['File', 'Size', 'Format', 'What it takes to read it'],
      profile.binaries.map((binary) => [
        binary.file,
        formatBytes(binary.bytes),
        binary.format,
        binary.toRead,
      ]),
    ),
    documentsSection(profile),
    '## Other files\n',
    table(
      ['Type', 'Files', 'Size'],
      profile.otherFiles.map((group) => [group.extension, `${group.files}`, formatBytes(group.bytes)]),
    ),
    '## Unreadable files\n',
    table(
      ['File', 'Reason', 'What to do'],
      profile.unreadable.map((file) => [file.file, file.reason, file.advice]),
    ),
  ].join('\n');
}

function overviewSection(profile: ExportProfile): string {
  const { files } = profile;
  const counts = [
    ['Files', `${files.total}`],
    ['Size', formatBytes(files.bytes)],
    ['Table files', `${files.tableFiles}`],
    ['Tables', `${profile.tables.length}`],
    ['Database and binary files', `${files.binaries}`],
    ['Documents', `${files.documents}`],
    ['Photos', `${files.photos}`],
    ['Other files', `${files.other}`],
  ];
  return [
    '## Overview\n',
    table(
      counts.map(([label = '']) => label),
      [counts.map(([, value = '']) => value)],
    ),
    `Shared wrapper folders removed from paths: ${profile.wrapperFolders}. System files and links skipped: ${profile.skippedSystemFiles}.\n`,
  ].join('\n');
}

function documentsSection(profile: ExportProfile): string {
  return [
    '## Documents and photos\n',
    'Counted per top-level folder and type. Folder names below the top level are not shown.\n',
    table(
      ['Folder', 'Kind', 'Type', 'Files', 'Size', 'PDF pages'],
      profile.documents.map((group) => [
        group.folder,
        group.kind,
        group.extension,
        `${group.files}`,
        formatBytes(group.bytes),
        group.pages === null ? '' : pageSummary(group.pages),
      ]),
    ),
    table(
      ['Folder', 'Files', 'Subfolders', 'Deepest subfolder level'],
      profile.folders.map((folder) => [
        folder.folder,
        `${folder.files}`,
        `${folder.subfolders}`,
        `${folder.deepestLevel}`,
      ]),
    ),
  ].join('\n');
}

function pageSummary(pages: NonNullable<ExportProfile['documents'][number]['pages']>): string {
  const counted =
    pages.counted === 0 ? 'none counted' : `${pages.total} in total, ${pages.min} to ${pages.max} per file`;
  return pages.unknown === 0 ? counted : `${counted}; ${pages.unknown} not counted`;
}

function renderTable(profile: TableProfile): string {
  const title = profile.table === null ? profile.file : `${profile.file} › ${profile.table}`;
  const facts = [
    `Format: ${profile.format}`,
    profile.encoding === null ? null : `encoding: ${profile.encoding}`,
    profile.delimiter === null ? null : `delimiter: ${profile.delimiter}`,
    `header: ${profile.header}`,
    `rows: ${profile.rows}`,
    profile.raggedRows === 0 ? null : `rows with a different field count: ${profile.raggedRows}`,
  ].filter((fact) => fact !== null);
  const note = profile.note === null ? '' : `\n${profile.note}.\n`;
  return [
    `### ${cell(title)}\n`,
    `${facts.join(' · ')}.\n${note}`,
    profile.columns.length === 0
      ? ''
      : table(
          ['Column', 'Type', 'Empty', 'Distinct', 'Length', 'Shape', 'Years', 'Key-like'],
          profile.columns.map(columnRow),
        ),
  ].join('\n');
}

function columnRow(column: ColumnProfile): string[] {
  const length =
    column.minLength === null ? '' : `${column.minLength} to ${column.maxLength ?? column.minLength}`;
  const years = column.years === null ? '' : `${column.years.from} to ${column.years.to}`;
  const key = column.keyLike ? (column.unique ? 'yes, unique' : 'yes') : '';
  const shape = column.example === null ? '' : `\`${column.example.replace(/`/g, "'")}\``;
  return [
    column.name,
    column.type,
    percent(column.emptyRate),
    `${column.distinct}`,
    length,
    shape,
    years,
    key,
  ];
}
