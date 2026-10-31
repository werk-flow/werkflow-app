import { jsonRecordOrEmpty } from '@/lib/supabase/json';

import { DOCUMENT_ROW_DRAG_MIME, type DocumentTableDragSelection } from './document-library-table';

/**
 * Reads what a drag carries into the document library: files and folders from
 * the desktop (through the browser's file-system entries) or library rows.
 */

type BrowserFileSystemEntry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
};

type BrowserFileSystemFileEntry = BrowserFileSystemEntry & {
  file: (callback: (file: File) => void, errorCallback: (error: DOMException) => void) => void;
};

type BrowserFileSystemDirectoryEntry = BrowserFileSystemEntry & {
  createReader: () => {
    readEntries: (
      callback: (entries: BrowserFileSystemEntry[]) => void,
      errorCallback: (error: DOMException) => void,
    ) => void;
  };
};

export type DroppedFile = { file: File; relativePath?: string };

function isDirectoryEntry(entry: BrowserFileSystemEntry): entry is BrowserFileSystemDirectoryEntry {
  return entry.isDirectory;
}

function isFileEntry(entry: BrowserFileSystemEntry): entry is BrowserFileSystemFileEntry {
  return entry.isFile;
}

function readFileEntry(entry: BrowserFileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function readDirectoryEntries(entry: BrowserFileSystemDirectoryEntry): Promise<BrowserFileSystemEntry[]> {
  const reader = entry.createReader();
  const entries: BrowserFileSystemEntry[] = [];

  async function readNextBatch(): Promise<BrowserFileSystemEntry[]> {
    // An unreadable directory batch ends the listing instead of leaving the drop pending.
    return new Promise((resolve) => {
      reader.readEntries(resolve, () => resolve([]));
    });
  }

  return (async () => {
    while (true) {
      const batch = await readNextBatch();
      if (batch.length === 0) return entries;
      entries.push(...batch);
    }
  })();
}

async function collectFilesFromEntry(
  entry: BrowserFileSystemEntry,
  parentPath = '',
): Promise<Array<{ file: File; relativePath: string }>> {
  const relativePath = parentPath ? `${parentPath}/${entry.name}` : entry.name;

  if (isFileEntry(entry)) {
    // An unreadable file (removed or locked since the drag began) is left out of the upload list.
    const file = await readFileEntry(entry).catch(() => null);
    return file ? [{ file, relativePath }] : [];
  }

  if (!isDirectoryEntry(entry)) return [];

  const children = await readDirectoryEntries(entry);
  const nestedFiles = await Promise.all(children.map((child) => collectFilesFromEntry(child, relativePath)));
  return nestedFiles.flat();
}

/** The dropped entries, read synchronously: a DataTransfer is only readable during its event. */
export function readDroppedEntries(dataTransfer: DataTransfer): BrowserFileSystemEntry[] {
  return Array.from(dataTransfer.items)
    .map((item): BrowserFileSystemEntry | null => item.webkitGetAsEntry?.() ?? null)
    .filter((entry): entry is BrowserFileSystemEntry => Boolean(entry));
}

/** Every file below the dropped entries, each with its path relative to the drop. */
export async function collectFilesFromEntries(entries: BrowserFileSystemEntry[]): Promise<DroppedFile[]> {
  const collectedFiles = await Promise.all(entries.map((entry) => collectFilesFromEntry(entry)));
  return collectedFiles.flat();
}

export function hasExternalFileDrag(dataTransfer: DataTransfer): boolean {
  return (
    Array.from(dataTransfer.types).includes('Files') ||
    Array.from(dataTransfer.items).some((item) => item.kind === 'file') ||
    dataTransfer.files.length > 0
  );
}

export function hasInternalRowDrag(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(DOCUMENT_ROW_DRAG_MIME);
}

function stringIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}

/** The dragged library rows; an empty or unreadable payload yields the fallback selection. */
export function readInternalRowDragSelection(
  dataTransfer: DataTransfer,
  fallbackSelection: DocumentTableDragSelection | null,
): DocumentTableDragSelection | null {
  const raw = dataTransfer.getData(DOCUMENT_ROW_DRAG_MIME);
  if (!raw) return fallbackSelection;

  try {
    const parsed: unknown = JSON.parse(raw);
    // A `null` payload is unreadable; any other value without the id lists yields none.
    if (parsed === null) return fallbackSelection;
    const payload = jsonRecordOrEmpty(parsed);
    return {
      folderIds: stringIds(payload.folderIds),
      documentIds: stringIds(payload.documentIds),
    };
  } catch {
    return fallbackSelection;
  }
}
