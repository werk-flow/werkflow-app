import { describe, expect, test } from 'bun:test';
import { type ExportSourceFile, PART_BYTE_LIMIT, PART_FILE_LIMIT, planFileParts } from './plan';

/** The archive name of every planned file, by its source path. */
function nameExportFiles(files: readonly ExportSourceFile[]): Map<string, string> {
  return new Map(
    planFileParts(files)
      .flat()
      .map((planned) => [planned.sourcePath, planned.archiveName]),
  );
}

const ORG = '20000000-0000-4000-8000-00000000000a';

function file(index: number, overrides: Partial<ExportSourceFile> = {}): ExportSourceFile {
  return {
    sourcePath: `${ORG}/doc-${index}/datei-${index}.pdf`,
    documentId: `doc-${String(index).padStart(5, '0')}`,
    versionNumber: null,
    fileBytes: 10,
    displayName: `Datei ${index}.pdf`,
    originalFileName: `datei-${index}.pdf`,
    location: ['Kunden'],
    ...overrides,
  };
}

function plannedPaths(parts: ReturnType<typeof planFileParts>): string[] {
  return parts.flatMap((part) => part.map((planned) => planned.sourcePath));
}

describe('organization export file plan', () => {
  test('puts every file into exactly one part', () => {
    const files = Array.from({ length: PART_FILE_LIMIT * 2 + 7 }, (_, index) => file(index));
    const parts = planFileParts([...files, files[3] ?? file(3)]);
    const paths = plannedPaths(parts);
    expect(paths.length).toBe(files.length);
    expect(new Set(paths)).toEqual(new Set(files.map((source) => source.sourcePath)));
    expect(parts.map((part) => part.length)).toEqual([PART_FILE_LIMIT, PART_FILE_LIMIT, 7]);
  });

  test('keeps each part within its byte limit, except a single larger file', () => {
    const big = Math.floor(PART_BYTE_LIMIT / 3);
    const files = [
      file(1, { fileBytes: big }),
      file(2, { fileBytes: big }),
      file(3, { fileBytes: big }),
      file(4, { fileBytes: big }),
      file(5, { fileBytes: PART_BYTE_LIMIT + 1 }),
      file(6, { fileBytes: 1 }),
    ];
    const parts = planFileParts(files);
    const bytes = new Map(files.map((source) => [source.sourcePath, source.fileBytes]));
    for (const part of parts) {
      const total = part.reduce((sum, planned) => sum + (bytes.get(planned.sourcePath) ?? 0), 0);
      expect(part.length === 1 || total <= PART_BYTE_LIMIT).toBe(true);
    }
    expect(plannedPaths(parts).sort()).toEqual(files.map((source) => source.sourcePath).sort());
  });

  test('gives no two files one name, also not in another letter case', () => {
    const names = nameExportFiles([
      file(1, { displayName: 'Rechnung.pdf' }),
      file(2, { displayName: 'rechnung.pdf' }),
      file(3, { displayName: 'Rechnung.pdf' }),
      file(4, { displayName: 'Rechnung', originalFileName: 'scan.PDF', versionNumber: 2 }),
    ]);
    const values = [...names.values()];
    expect(new Set(values.map((name) => name.toLowerCase())).size).toBe(4);
    expect(names.get(file(1).sourcePath)).toBe('Dateien/Kunden/Rechnung.pdf');
    expect(names.get(file(3).sourcePath)).toBe('Dateien/Kunden/Rechnung (2).pdf');
    expect(names.get(file(2).sourcePath)).toBe('Dateien/Kunden/rechnung (3).pdf');
    expect(names.get(file(4).sourcePath)).toBe('Dateien/Kunden/Rechnung (Version 2).PDF');
  });

  test("ends every name in the uploaded file's extension, keeping another display suffix in the name", () => {
    const names = nameExportFiles([
      file(1, { displayName: 'Rechnung 2026.01', originalFileName: 'rechnung.pdf' }),
      file(2, { displayName: 'Lieferschein', originalFileName: 'scan.PDF' }),
      file(3, { displayName: 'Angebot.PDF', originalFileName: 'angebot.pdf' }),
      file(4, { displayName: 'Rechnung 2026.01', originalFileName: 'rechnung-alt.pdf', versionNumber: 1 }),
      file(5, { displayName: 'Rechnung 2026.01.pdf', originalFileName: 'kopie.pdf' }),
      file(6, { displayName: 'Notiz.txt', originalFileName: 'notiz' }),
    ]);
    expect(names.get(file(1).sourcePath)).toBe('Dateien/Kunden/Rechnung 2026.01.pdf');
    expect(names.get(file(2).sourcePath)).toBe('Dateien/Kunden/Lieferschein.PDF');
    expect(names.get(file(3).sourcePath)).toBe('Dateien/Kunden/Angebot.pdf');
    expect(names.get(file(4).sourcePath)).toBe('Dateien/Kunden/Rechnung 2026.01 (Version 1).pdf');
    expect(names.get(file(5).sourcePath)).toBe('Dateien/Kunden/Rechnung 2026.01 (2).pdf');
    expect(names.get(file(6).sourcePath)).toBe('Dateien/Kunden/Notiz.txt');
  });

  test('names stay inside the archive folder, whatever the folder or file is called', () => {
    const names = nameExportFiles([
      file(1, { location: ['..', 'a/b', ' . '], displayName: '../../etc/passwd' }),
      file(2, { location: [''], displayName: 'Bericht: Mai?*.pdf' }),
      file(3, { displayName: '...' }),
    ]);
    for (const name of names.values()) {
      expect(name.startsWith('Dateien/')).toBe(true);
      expect(name.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')).toBe(
        false,
      );
      expect(/[\\:*?"<>|]/.test(name)).toBe(false);
    }
    expect(names.get(file(2).sourcePath)).toBe('Dateien/_/Bericht_ Mai__.pdf');
  });

  test('is the same plan for the same files in any order', () => {
    const files = Array.from({ length: 30 }, (_, index) => file(index, { displayName: 'Foto.jpg' }));
    expect(planFileParts([...files].reverse())).toEqual(planFileParts(files));
  });
});
