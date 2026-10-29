import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SENSITIVE_VALUES, writeSyntheticExport } from '../testing/fixtures/export-profile-world';
import { selfCheckOutput } from './output-safety';
import { profileExportFolder, type ExportProfile, type TableProfile } from './profile-export';
import { renderProfile } from './profile-report';

const repositoryRoot = resolve(import.meta.dir, '../..');
let workspace = '';
let exportFolder = '';
let profile: ExportProfile;

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'export-profile-'));
  exportFolder = join(workspace, 'export');
  writeSyntheticExport(exportFolder);
  profile = profileExportFolder(exportFolder, { maskLabels: false });
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function tableNamed(file: string, table: string | null = null): TableProfile {
  const found = profile.tables.find((candidate) => candidate.file === file && candidate.table === table);
  if (!found) throw new Error(`no table ${file} ${table ?? ''}`);
  return found;
}

function column(table: TableProfile, name: string): TableProfile['columns'][number] {
  const found = table.columns.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`no column ${name}`);
  return found;
}

describe('export profile: tables', () => {
  test('a Windows-1252 semicolon CSV reports its encoding, header, row count and column types', () => {
    const addresses = tableNamed('Adressen.csv');
    expect(addresses).toMatchObject({
      encoding: 'windows-1252',
      delimiter: ';',
      header: 'first row',
      rows: 6,
    });
    expect(addresses.columns.map((entry) => entry.name)).toEqual([
      'KdNr',
      'Name',
      'Vorname',
      'Strasse',
      'PLZ',
      'Ort',
      'Telefon',
      'E-Mail',
      'Angelegt',
    ]);
    expect(column(addresses, 'KdNr')).toMatchObject({
      type: 'integer',
      distinct: 6,
      unique: true,
      keyLike: true,
    });
    expect(column(addresses, 'PLZ').type).toBe('digit_code');
    expect(column(addresses, 'Telefon').type).toBe('phone');
    expect(column(addresses, 'E-Mail')).toMatchObject({ type: 'email', emptyRate: 0.167, nonEmpty: 5 });
    expect(column(addresses, 'Ort')).toMatchObject({ type: 'text', distinct: 3, minLength: 6, maxLength: 7 });
    expect(column(addresses, 'Angelegt')).toMatchObject({ type: 'date', years: { from: 2019, to: 2024 } });
  });

  test('a quoted field keeps its delimiter inside one column, and its shape masks every letter and digit', () => {
    const name = column(tableNamed('Adressen.csv'), 'Name');
    expect(name.distinct).toBe(6);
    expect(name.maxLength).toBe(10);
    expect(column(tableNamed('Adressen.csv'), 'Strasse').example).toMatch(/^Xxx+ 99?x?$/);
  });

  test('a file without a header row gets positional column names, never its first row', () => {
    const headerless = tableNamed('Kontakte_ohne_Kopf.csv');
    expect(headerless).toMatchObject({ header: 'none detected', rows: 3, encoding: 'utf-8' });
    expect(headerless.columns.map((entry) => entry.name)).toEqual([
      'column_1',
      'column_2',
      'column_3',
      'column_4',
      'column_5',
      'column_6',
    ]);
    expect(column(headerless, 'column_6').type).toBe('iban');
  });

  test('an Excel sheet reports its rows, its date cells as years and its decimal amounts', () => {
    const orders = tableNamed('Auftraege.xlsx', 'Aufträge');
    expect(orders).toMatchObject({ format: 'excel', header: 'first row', rows: 4 });
    expect(column(orders, 'Datum')).toMatchObject({
      type: 'date',
      years: { from: 2020, to: 2025 },
      example: null,
      maxLength: null,
    });
    expect(column(orders, 'Betrag').type).toBe('decimal');
    expect(column(orders, 'KdNr')).toMatchObject({ type: 'integer', distinct: 3, unique: false });
  });

  test('an XML record set becomes one table with its attributes and child elements as columns', () => {
    const bookings = tableNamed('Zeiten.xml', 'Zeiterfassung/Buchung');
    expect(bookings.rows).toBe(4);
    expect(bookings.columns.map((entry) => entry.name)).toEqual([
      '@id',
      'Mitarbeiter',
      'AuftragNr',
      'Datum',
      'Stunden',
      'Notiz',
    ]);
    expect(column(bookings, 'Stunden').type).toBe('decimal');
    expect(column(bookings, 'Notiz').emptyRate).toBe(0.75);
    expect(column(bookings, 'Datum').years).toEqual({ from: 2024, to: 2025 });
  });

  test('a DATANORM file becomes one table per record type', () => {
    const articles = tableNamed('Artikel/DATANORM.001', 'record type A');
    expect(articles).toMatchObject({ format: 'datanorm', header: 'positional', rows: 3 });
    expect(column(articles, 'field_3')).toMatchObject({ type: 'text', unique: true, keyLike: true });
    expect(tableNamed('Artikel/DATANORM.001', 'record type V').rows).toBe(1);
  });
});

describe('export profile: relations and other files', () => {
  test('a column whose values appear in another table key is reported as a relation', () => {
    const pairs = profile.relations.map((relation) => [
      `${relation.key.table} › ${relation.key.column}`,
      `${relation.referencedBy.table} › ${relation.referencedBy.column}`,
      relation.coverage,
    ]);
    expect(pairs).toContainEqual(['Adressen.csv › KdNr', 'Auftraege.xlsx › Aufträge › KdNr', 1]);
    expect(pairs).toContainEqual([
      'Auftraege.xlsx › Aufträge › AuftragNr',
      'Zeiten.xml › Zeiterfassung/Buchung › AuftragNr',
      1,
    ]);
    expect(pairs.filter(([key]) => String(key).endsWith('Vorname'))).toEqual([]);
  });

  test('a database backup is listed by name, size and what it takes to read it', () => {
    expect(profile.binaries).toEqual([
      {
        file: 'Sicherung/sykasoft.bak',
        bytes: 11,
        format: 'SQL Server backup (Microsoft Tape Format)',
        toRead: expect.stringContaining('SQL Server'),
      },
    ]);
  });

  test('documents and photos are counted per top-level folder and type, with PDF pages', () => {
    expect(profile.documents).toContainEqual(
      expect.objectContaining({
        folder: 'Dokumente',
        kind: 'document',
        extension: '.pdf',
        files: 3,
        pages: { counted: 3, total: 6, min: 1, max: 3, unknown: 0 },
      }),
    );
    expect(profile.documents).toContainEqual(
      expect.objectContaining({ folder: 'Fotos', kind: 'photo', extension: '.jpg', files: 2, pages: null }),
    );
    expect(profile.folders).toContainEqual({ folder: 'Dokumente', files: 3, subfolders: 4, deepestLevel: 3 });
  });

  test('the wrapper folder, system files and unknown files are accounted for', () => {
    expect(profile.wrapperFolders).toBe(1);
    expect(profile.skippedSystemFiles).toBe(1);
    expect(profile.otherFiles).toEqual([{ extension: '.cfg', files: 1, bytes: expect.any(Number) }]);
    expect(profile.unreadable).toEqual([]);
    expect(profile.files).toMatchObject({
      total: 12,
      tableFiles: 5,
      binaries: 1,
      documents: 3,
      photos: 2,
      other: 1,
    });
    expect(profile.tables).toHaveLength(7);
  });
});

describe('export profile: no raw value leaves the profiler', () => {
  test('neither profile.md nor profile.json contains a value from the export, and the self-check passes', () => {
    const report = renderProfile(profile, '2026-11-05');
    for (const value of SENSITIVE_VALUES) {
      expect({ value, inMarkdown: report.markdown.includes(value) }).toEqual({ value, inMarkdown: false });
      expect({ value, inJson: report.json.includes(value) }).toEqual({ value, inJson: false });
    }
    expect(
      selfCheckOutput([
        { file: 'profile.md', text: report.markdown },
        { file: 'profile.json', text: report.json },
      ]),
    ).toEqual([]);
  });

  test('--mask-labels shows every export name as a shape', () => {
    const masked = profileExportFolder(exportFolder, { maskLabels: true });
    expect(masked.tables.map((table) => table.file)).toContain('Xxxxxxxx.xxx');
    expect(masked.tables.flatMap((table) => table.columns.map((entry) => entry.name))).toContain('XxXx');
  });
});

describe('export profile: the command line', () => {
  const run = (...args: string[]) =>
    Bun.spawnSync(['bun', join(repositoryRoot, 'scripts/migration/profile-export.ts'), ...args], {
      cwd: workspace,
    });

  test('writes profile.md and profile.json to an empty folder outside every repository, and prints no value', () => {
    const output = join(workspace, 'profiles');
    const result = run(exportFolder, '--out', output);
    const printed = `${result.stdout.toString()}${result.stderr.toString()}`;
    expect(result.exitCode, printed).toBe(0);
    expect(readdirSync(output).sort()).toEqual(['profile.json', 'profile.md']);
    expect(readFileSync(join(output, 'profile.md'), 'utf8')).toContain('## Relations');
    for (const value of SENSITIVE_VALUES)
      expect({ value, printed: printed.includes(value) }).toEqual({ value, printed: false });
  });

  test('refuses an output folder inside a Git repository and writes nothing', () => {
    const output = join(repositoryRoot, '.export-profile-refusal-probe');
    const result = run(exportFolder, '--out', output);
    expect(result.exitCode, result.stderr.toString()).toBe(2);
    expect(result.stderr.toString()).toContain('inside a Git repository');
    expect(existsSync(output)).toBe(false);
  });
});
