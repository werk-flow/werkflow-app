// The file plan of an organization export: every original file gets one
// name in the archive and one file part (werk-flow/werkflow-planning#287).
// A part holds at most PART_FILE_LIMIT files and PART_BYTE_LIMIT bytes, so
// it builds within one request; a larger single file gets a part of its own.
// start_organization_export refuses a plan that misses, repeats or adds a
// file, or repeats a name.

export const PART_FILE_LIMIT = 1_000;
export const PART_BYTE_LIMIT = 200 * 1024 * 1024;

/** The folder of every file in the archive. */
const FILES_ROOT = 'Dateien';
const MAX_SEGMENT_LENGTH = 120;

/**
 * One stored original: a document's current file or one of its earlier
 * versions, or a file of the company document profile.
 */
export type ExportSourceFile = {
  sourcePath: string;
  /** Null for a file of the company document profile, which belongs to no document. */
  documentId: string | null;
  /** Null for the current file. */
  versionNumber: number | null;
  fileBytes: number;
  /** The document's name in WerkFlow. */
  displayName: string;
  /** The name the file had when it was uploaded; its extension is the exported file's. */
  originalFileName: string;
  /** The folders below `Dateien/`, outermost first. */
  location: readonly string[];
};

/** A planned file as start_organization_export takes it. */
export type PlannedFile = { sourcePath: string; archiveName: string };

// A name every archive program on Windows, macOS and Linux unpacks as one
// file: no separators or reserved characters, no leading or trailing dots or
// spaces, never empty, `.` or `..`.
function safeSegment(value: string): string {
  const cleaned = value
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '_')
    .replace(/[. ]+$/, '');
  return cleaned === '' ? '_' : cleaned;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot >= name.length - 11 ? name.slice(dot) : '';
}

/**
 * The file name of one source before collisions: `Angebot.pdf`,
 * `Angebot (Version 2).pdf`. The extension is the uploaded file's, so the
 * file opens with the right program. A display name ending in it drops it;
 * any other suffix stays part of the name: `Rechnung 2026.01.pdf`.
 */
function baseName(file: ExportSourceFile): { stem: string; extension: string } {
  const display = safeSegment(file.displayName);
  const extension = extensionOf(safeSegment(file.originalFileName));
  const displayStem =
    extension !== '' && extensionOf(display).toLowerCase() === extension.toLowerCase()
      ? display.slice(0, -extension.length)
      : display;
  const stem = file.versionNumber === null ? displayStem : `${displayStem} (Version ${file.versionNumber})`;
  // Room for a ` (99)` suffix; a cut never leaves a trailing dot or space.
  const cut = stem.slice(0, MAX_SEGMENT_LENGTH - extension.length - 6).replace(/[. ]+$/, '');
  return { stem: cut === '' ? '_' : cut, extension };
}

/** The items in code-unit order of their keys; every key is unique. */
function inKeyOrder<Item>(items: readonly Item[], key: (item: Item) => string): Item[] {
  const byKey = new Map(items.map((item) => [key(item), item]));
  return [...byKey.keys()].sort().flatMap((itemKey) => {
    const item = byKey.get(itemKey);
    return item === undefined ? [] : [item];
  });
}

/**
 * The archive name of every file: its location and name, with ` (2)`,
 * ` (3)` … added in a fixed order where names would meet, also names that
 * differ only in letter case.
 */
function nameExportFiles(files: readonly ExportSourceFile[]): Map<string, string> {
  const unique = [...new Map(files.map((file) => [file.sourcePath, file])).values()];
  const ordered = inKeyOrder(
    unique.map((file) => {
      const folder = [FILES_ROOT, ...file.location.map(safeSegment)].join('/');
      return { file, folder, ...baseName(file) };
    }),
    ({ file, folder, stem, extension }) =>
      [
        `${folder}/${stem}${extension}`,
        file.documentId ?? '',
        String(file.versionNumber ?? 0).padStart(10, '0'),
        file.sourcePath,
      ].join('\u0000'),
  );
  const taken = new Set<string>();
  const names = new Map<string, string>();
  for (const { file, folder, stem, extension } of ordered) {
    let name = `${folder}/${stem}${extension}`;
    for (let copy = 2; taken.has(name.toLowerCase()); copy += 1)
      name = `${folder}/${stem} (${copy})${extension}`;
    taken.add(name.toLowerCase());
    names.set(file.sourcePath, name);
  }
  return names;
}

/**
 * The file parts of an export in archive-name order. Each source path lands
 * in exactly one part; a path listed twice is planned once.
 */
export function planFileParts(files: readonly ExportSourceFile[]): PlannedFile[][] {
  const unique = [...new Map(files.map((file) => [file.sourcePath, file])).values()];
  const names = nameExportFiles(unique);
  const planned = inKeyOrder(
    unique.map((file) => ({ file, archiveName: names.get(file.sourcePath) ?? '' })),
    (entry) => entry.archiveName,
  );
  const parts: PlannedFile[][] = [];
  let current: PlannedFile[] = [];
  let currentBytes = 0;
  for (const { file, archiveName } of planned) {
    if (
      current.length > 0 &&
      (current.length >= PART_FILE_LIMIT || currentBytes + file.fileBytes > PART_BYTE_LIMIT)
    ) {
      parts.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push({ sourcePath: file.sourcePath, archiveName });
    currentBytes += file.fileBytes;
  }
  if (current.length > 0) parts.push(current);
  return parts;
}
