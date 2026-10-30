import { readFileSync } from 'node:fs';

// Documents and photos: counts, sizes and PDF page counts per top-level
// folder and type. No content, no text extraction, no names below the
// top-level folder: folders below it are often named after customers.

type PageSummary = { counted: number; total: number; min: number; max: number; unknown: number };

export type DocumentGroup = {
  folder: string;
  kind: 'document' | 'photo';
  extension: string;
  files: number;
  bytes: number;
  pages: PageSummary | null;
};

export type FolderShape = { folder: string; files: number; subfolders: number; deepestLevel: number };

const PDF_PAGE_COUNT_LIMIT_BYTES = 200 * 1024 * 1024;

/** The page count of a PDF from its page objects, or null when it cannot be read cheaply. */
function pdfPageCount(path: string, bytes: number): number | null {
  if (bytes > PDF_PAGE_COUNT_LIMIT_BYTES) return null;
  const text = new TextDecoder('latin1').decode(readFileSync(path));
  const pages = text.match(/\/Type\s*\/Page(?![\w])/g)?.length ?? 0;
  if (pages > 0) return pages;
  const counts = [...text.matchAll(/\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)/g)].map((match) =>
    Number(match[1]),
  );
  return counts.length > 0 ? Math.max(...counts) : null;
}

export class DocumentInventory {
  private readonly groups = new Map<string, DocumentGroup>();
  private readonly folders = new Map<
    string,
    { files: number; subfolders: Set<string>; deepestLevel: number }
  >();

  /**
   * Counts one file. `extension` is the shown label; `below` holds the folder
   * names between the top-level folder and the file, used only as counts.
   */
  add(
    file: { path: string; bytes: number; extension: string; isPdf: boolean },
    kind: 'document' | 'photo',
    folder: string,
    below: readonly string[],
  ): void {
    const { extension } = file;
    const key = `${folder}\u0000${kind}\u0000${extension}`;
    const group = this.groups.get(key) ?? { folder, kind, extension, files: 0, bytes: 0, pages: null };
    group.files += 1;
    group.bytes += file.bytes;
    if (file.isPdf) group.pages = addPages(group.pages, pdfPageCount(file.path, file.bytes));
    this.groups.set(key, group);
    const shape = this.folders.get(folder) ?? { files: 0, subfolders: new Set<string>(), deepestLevel: 0 };
    shape.files += 1;
    below.forEach((_, depth) => shape.subfolders.add(below.slice(0, depth + 1).join('\u0000')));
    shape.deepestLevel = Math.max(shape.deepestLevel, below.length);
    this.folders.set(folder, shape);
  }

  documentGroups(): DocumentGroup[] {
    return [...this.groups.values()];
  }

  folderShapes(): FolderShape[] {
    return [...this.folders].map(([folder, shape]) => ({
      folder,
      files: shape.files,
      subfolders: shape.subfolders.size,
      deepestLevel: shape.deepestLevel,
    }));
  }
}

function addPages(summary: PageSummary | null, pages: number | null): PageSummary {
  const current = summary ?? { counted: 0, total: 0, min: 0, max: 0, unknown: 0 };
  if (pages === null) return { ...current, unknown: current.unknown + 1 };
  return {
    counted: current.counted + 1,
    total: current.total + pages,
    min: current.counted === 0 ? pages : Math.min(current.min, pages),
    max: Math.max(current.max, pages),
    unknown: current.unknown,
  };
}
