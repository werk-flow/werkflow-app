import { closeSync, lstatSync, openSync, readdirSync, readSync } from 'node:fs';
import { extname, join } from 'node:path';
import { maskShape } from './personal-data';
import { looksLikeText } from './text-decoding';

// Walks the export folder and sorts each file into a category by its
// extension and its first bytes. Reads no file content beyond the head.

export type ExportFile = { path: string; segments: readonly string[]; bytes: number };

export type FileCategory =
  | { kind: 'delimited' }
  | { kind: 'excel' }
  | { kind: 'xml' }
  | { kind: 'datanorm' }
  | { kind: 'document' }
  | { kind: 'photo' }
  | { kind: 'binary'; format: string; toRead: string }
  | { kind: 'other' };

const SYSTEM_FILES = /^(?:\.DS_Store|Thumbs\.db|desktop\.ini|\._.*|~\$.*|\.~lock\..*)$/i;
const SYSTEM_FOLDERS = new Set(['__MACOSX', '.Spotlight-V100', '.Trashes', '.fseventsd']);
const PHOTO = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.tif', '.tiff', '.gif', '.bmp', '.webp']);
const DOCUMENT = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.odt',
  '.rtf',
  '.msg',
  '.eml',
  '.xps',
  '.ppt',
  '.pptx',
  '.htm',
  '.html',
  '.dwg',
  '.dxf',
]);
const DELIMITED = new Set(['.csv', '.tsv', '.txt', '.dat', '.asc', '.prn', '.tab']);

const TO_READ = {
  sqlServer:
    'Restore it into a local Microsoft SQL Server (Express or Developer edition) on this Mac or an offline machine, then export each table as CSV with a header row. Ask Sykasoft support for the engine version and the database names.',
  access:
    'Open it in Microsoft Access, or run mdbtools (mdb-tables, mdb-export) locally, and export each table as CSV with a header row.',
  sqlite: 'Open it with the sqlite3 command line tool and export each table as CSV with a header row.',
  firebird: 'Restore it with a local Firebird server (gbak) and export each table as CSV with a header row.',
  dbase: 'Open it in LibreOffice Calc and save it as CSV with a header row.',
  sqlDump:
    'Restore it into a local database server of the same kind, then export each table as CSV with a header row.',
  postgres:
    'Restore it with pg_restore into a local PostgreSQL, then export each table as CSV with a header row.',
  oldExcel:
    'Open it in Excel or LibreOffice Calc and save it as .xlsx (or each sheet as CSV), then run the profiler again.',
  lockedExcel: 'Remove the password in Excel, save it as .xlsx, then run the profiler again.',
  archive: 'Unpack it into the input folder, then run the profiler again.',
  unknown: 'Unknown format: ask Willert which program wrote it and how to export it as CSV.',
} as const;

const BINARY_BY_EXTENSION: Readonly<Record<string, { format: string; toRead: string }>> = {
  '.bak': { format: 'database backup (.bak)', toRead: TO_READ.sqlServer },
  '.mdf': { format: 'SQL Server data file', toRead: TO_READ.sqlServer },
  '.ndf': { format: 'SQL Server data file', toRead: TO_READ.sqlServer },
  '.ldf': { format: 'SQL Server log file', toRead: TO_READ.sqlServer },
  '.trn': { format: 'SQL Server log backup', toRead: TO_READ.sqlServer },
  '.mdb': { format: 'Microsoft Access database', toRead: TO_READ.access },
  '.accdb': { format: 'Microsoft Access database', toRead: TO_READ.access },
  '.db': { format: 'database file (.db)', toRead: TO_READ.unknown },
  '.sqlite': { format: 'SQLite database', toRead: TO_READ.sqlite },
  '.sqlite3': { format: 'SQLite database', toRead: TO_READ.sqlite },
  '.fdb': { format: 'Firebird database', toRead: TO_READ.firebird },
  '.gdb': { format: 'InterBase or Firebird database', toRead: TO_READ.firebird },
  '.fbk': { format: 'Firebird backup', toRead: TO_READ.firebird },
  '.dbf': { format: 'dBASE table', toRead: TO_READ.dbase },
  '.sql': { format: 'SQL dump', toRead: TO_READ.sqlDump },
  '.dump': { format: 'database dump', toRead: TO_READ.sqlDump },
  '.backup': { format: 'database backup', toRead: TO_READ.sqlDump },
  '.zip': { format: 'ZIP archive', toRead: TO_READ.archive },
  '.7z': { format: '7-Zip archive', toRead: TO_READ.archive },
  '.rar': { format: 'RAR archive', toRead: TO_READ.archive },
  '.gz': { format: 'gzip archive', toRead: TO_READ.archive },
  '.tgz': { format: 'gzip archive', toRead: TO_READ.archive },
  '.tar': { format: 'tar archive', toRead: TO_READ.archive },
};

const KNOWN_EXTENSIONS: ReadonlySet<string> = new Set([
  ...PHOTO,
  ...DOCUMENT,
  ...DELIMITED,
  ...Object.keys(BINARY_BY_EXTENSION),
  '.xlsx',
  '.xlsm',
  '.xls',
  '.xml',
  '.cfg',
  '.ini',
  '.log',
  '.json',
]);

/** A file's extension as the profile may show it: a known one in clear, any other as a shape. */
export function extensionLabel(name: string): string {
  const extension = extname(name).toLowerCase();
  if (extension === '') return '(none)';
  return KNOWN_EXTENSIONS.has(extension) ? extension : maskShape(extension, 12);
}

/** Every regular file below `root`, without system files and symbolic links. */
export function walkExportFolder(root: string): { files: ExportFile[]; skippedSystemFiles: number } {
  const files: ExportFile[] = [];
  let skippedSystemFiles = 0;
  const visit = (folder: string, segments: readonly string[]): void => {
    const entries = readdirSync(folder, { withFileTypes: true }).sort((first, second) =>
      first.name.localeCompare(second.name),
    );
    for (const entry of entries) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) {
        if (SYSTEM_FOLDERS.has(entry.name)) skippedSystemFiles += 1;
        else visit(path, [...segments, entry.name]);
      } else if (!entry.isFile() || SYSTEM_FILES.test(entry.name)) skippedSystemFiles += 1;
      else files.push({ path, segments: [...segments, entry.name], bytes: lstatSync(path).size });
    }
  };
  visit(root, []);
  return { files, skippedSystemFiles };
}

/** The first bytes of a file. */
export function readHead(path: string, length = 4096): Uint8Array {
  const descriptor = openSync(path, 'r');
  try {
    const buffer = new Uint8Array(length);
    const read = readSync(descriptor, buffer, 0, length, 0);
    return buffer.subarray(0, read);
  } finally {
    closeSync(descriptor);
  }
}

function startsWith(head: Uint8Array, signature: readonly number[] | string, offset = 0): boolean {
  const bytes =
    typeof signature === 'string' ? [...signature].map((character) => character.charCodeAt(0)) : signature;
  return bytes.every((byte, index) => head[offset + index] === byte);
}

function binaryByMagic(head: Uint8Array): { format: string; toRead: string } | null {
  if (startsWith(head, 'TAPE'))
    return { format: 'SQL Server backup (Microsoft Tape Format)', toRead: TO_READ.sqlServer };
  if (startsWith(head, 'SQLite format 3')) return { format: 'SQLite database', toRead: TO_READ.sqlite };
  if (startsWith(head, 'Standard Jet DB', 4) || startsWith(head, 'Standard ACE DB', 4))
    return { format: 'Microsoft Access database', toRead: TO_READ.access };
  if (startsWith(head, 'PGDMP')) return { format: 'PostgreSQL custom dump', toRead: TO_READ.postgres };
  if (startsWith(head, [0x1f, 0x8b])) return { format: 'gzip archive', toRead: TO_READ.archive };
  if (startsWith(head, [0x37, 0x7a, 0xbc, 0xaf])) return { format: '7-Zip archive', toRead: TO_READ.archive };
  if (startsWith(head, 'Rar!')) return { format: 'RAR archive', toRead: TO_READ.archive };
  return null;
}

function isImage(head: Uint8Array): boolean {
  return (
    startsWith(head, [0xff, 0xd8, 0xff]) ||
    startsWith(head, [0x89, 0x50, 0x4e, 0x47]) ||
    startsWith(head, 'GIF8') ||
    startsWith(head, [0x49, 0x49, 0x2a, 0x00]) ||
    startsWith(head, [0x4d, 0x4d, 0x00, 0x2a]) ||
    (startsWith(head, 'ftyp', 4) &&
      /heic|heix|mif1/.test(new TextDecoder('latin1').decode(head.subarray(8, 12))))
  );
}

/** The category of one export file, from its name and first bytes. */
export function categorize(name: string, head: Uint8Array): FileCategory {
  const extension = extname(name).toLowerCase();
  const isZip = startsWith(head, [0x50, 0x4b, 0x03, 0x04]);
  const isOle = startsWith(head, [0xd0, 0xcf, 0x11, 0xe0]);
  if (PHOTO.has(extension) || isImage(head)) return { kind: 'photo' };
  if (extension === '.pdf' || startsWith(head, '%PDF')) return { kind: 'document' };
  if (['.xlsx', '.xlsm', '.xls'].includes(extension) && isZip) return { kind: 'excel' };
  if (extension === '.xls' && isOle)
    return { kind: 'binary', format: 'Excel 97-2003 workbook (.xls)', toRead: TO_READ.oldExcel };
  if (['.xlsx', '.xlsm'].includes(extension) && isOle)
    return { kind: 'binary', format: 'password-protected Excel workbook', toRead: TO_READ.lockedExcel };
  if (/^dat(?:anorm|preis)\.\w{3}$/i.test(name) || ['.wrg', '.rab'].includes(extension))
    return { kind: 'datanorm' };
  const magic = binaryByMagic(head);
  if (magic) return { kind: 'binary', ...magic };
  const byExtension = BINARY_BY_EXTENSION[extension];
  if (byExtension) return { kind: 'binary', ...byExtension };
  if (DOCUMENT.has(extension)) return { kind: 'document' };
  if (!looksLikeText(head)) return isZip || isOle ? { kind: 'document' } : { kind: 'other' };
  const text = new TextDecoder('latin1').decode(head).trimStart();
  if (extension === '.xml' || text.startsWith('<?xml')) return { kind: 'xml' };
  if (DELIMITED.has(extension) || extension === '.xls') return { kind: 'delimited' };
  return { kind: 'other' };
}
