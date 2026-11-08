import { describe, expect, test } from 'bun:test';
import { INVENTORY_IMPORT_MAX_ROWS } from './action-inputs';
import { importInventoryRowsSchema } from './action-schemas';
import { buildImportRows, guessMapping, IMPORT_COLUMNS, importResultBanner, parseCsv } from './csv-import';

// The widest header one import reads; the refusal message names it.
const MAX_HEADER_COLUMNS = 200;

describe('parseCsv', () => {
  test('detects the semicolon delimiter and keeps quoted delimiters and quotes', () => {
    expect(parseCsv('Artikel;Bestand;Notiz\r\n"Rohr; 22 mm";4;"sagt ""ok"""\r\n\r\nMuffe;2\n')).toEqual({
      ok: true,
      headers: ['Artikel', 'Bestand', 'Notiz'],
      rows: [
        { Artikel: 'Rohr; 22 mm', Bestand: '4', Notiz: 'sagt "ok"' },
        { Artikel: 'Muffe', Bestand: '2', Notiz: '' },
      ],
    });
  });

  test('detects the comma delimiter when it splits the header further', () => {
    expect(parseCsv('Name,Menge\nVentil,3')).toEqual({
      ok: true,
      headers: ['Name', 'Menge'],
      rows: [{ Name: 'Ventil', Menge: '3' }],
    });
  });

  test('an empty file has no headers and no rows', () => {
    expect(parseCsv('\n\n')).toEqual({ ok: true, headers: [], rows: [] });
  });

  test('a typical export imports the same rows through the guessed mapping', () => {
    const parsed = parseCsv(
      'Artikelname;Artikelnummer;Lager;Bestand;Einkaufspreis;Abrechenbar\n' +
        'Kupferrohr 15 mm;KR-15;Hauptlager;12,5;3,20 €;ja\n' +
        'Pressfitting;PF-22;Transporter 1;40;0,85;nein\n',
    );
    if (!parsed.ok) throw new Error(parsed.message);
    expect(buildImportRows(parsed.rows, guessMapping(parsed.headers))).toEqual([
      expect.objectContaining({
        name: 'Kupferrohr 15 mm',
        internalSku: 'KR-15',
        locationName: 'Hauptlager',
        quantity: 12.5,
        purchasePriceCents: 320,
        isBillable: true,
      }),
      expect.objectContaining({
        name: 'Pressfitting',
        internalSku: 'PF-22',
        locationName: 'Transporter 1',
        quantity: 40,
        purchasePriceCents: 85,
        isBillable: false,
      }),
    ]);
  });
});

describe('parseCsv bounds its work by what the import can use', () => {
  const header = (columns: number) =>
    Array.from({ length: columns }, (_, index) => `Spalte ${index}`).join(';');
  const dataRows = (count: number) =>
    Array.from({ length: count }, (_, index) => `Artikel ${index}`).join('\n');

  test('a wide header over short ragged rows is refused before any row is built', () => {
    const parsed = parseCsv(`${header(20_000)}\n${dataRows(200)}`);
    expect(parsed).toEqual({
      ok: false,
      message:
        'Die CSV-Datei hat mehr als 200 Spalten. Lösche die Spalten, die du nicht importierst, und wähle die Datei erneut.',
    });
  });

  test('more data rows than one import takes are refused before any row is built', () => {
    const parsed = parseCsv(`Artikel\n${dataRows(INVENTORY_IMPORT_MAX_ROWS + 1)}`);
    expect(parsed).toEqual({
      ok: false,
      message:
        'Die CSV-Datei hat mehr als 5.000 Datenzeilen. Teile sie auf mehrere Dateien auf und importiere sie nacheinander.',
    });
  });

  test('a file at either limit is read completely', () => {
    const atColumnLimit = parseCsv(`${header(MAX_HEADER_COLUMNS)}\n${dataRows(3)}`);
    expect(atColumnLimit.ok && atColumnLimit.rows.length).toBe(3);
    // Blank lines are not data rows.
    const atRowLimit = parseCsv(`Artikel\n\n${dataRows(INVENTORY_IMPORT_MAX_ROWS)}\n\n`);
    expect(atRowLimit.ok && atRowLimit.rows.length).toBe(INVENTORY_IMPORT_MAX_ROWS);
  });
});

describe('guessMapping', () => {
  test('maps German headers to import columns', () => {
    const mapping = guessMapping(['Bezeichnung', 'Lagerort', 'Menge', 'EAN', 'Einkaufspreis', 'Abrechenbar']);
    expect(mapping.name).toBe('Bezeichnung');
    expect(mapping.locationName).toBe('Lagerort');
    expect(mapping.quantity).toBe('Menge');
    expect(mapping.barcode).toBe('EAN');
    expect(mapping.purchasePriceCents).toBe('Einkaufspreis');
    expect(mapping.isBillable).toBe('Abrechenbar');
    expect(mapping.notes).toBeUndefined();
  });

  test('prefers exact labels and never guesses one header for two columns', () => {
    const mapping = guessMapping([
      'Artikelname',
      'Artikelnummer',
      'Mindestbestand',
      'Zielbestand',
      'Bestand',
      'Typ',
      'Lieferanten-Nr.',
    ]);
    expect(mapping.name).toBe('Artikelname');
    expect(mapping.internalSku).toBe('Artikelnummer');
    expect(mapping.quantity).toBe('Bestand');
    expect(mapping.minimumStock).toBe('Mindestbestand');
    expect(mapping.targetStock).toBe('Zielbestand');
    expect(mapping.itemType).toBe('Typ');
    expect(mapping.supplierArticleNumber).toBe('Lieferanten-Nr.');
  });

  test('a stock threshold or an article column is not guessed as quantity or type', () => {
    const mapping = guessMapping(['Artikel', 'Mindestmenge', 'Anzahl']);
    expect(mapping.name).toBe('Artikel');
    expect(mapping.itemType).toBeUndefined();
    expect(mapping.minimumStock).toBe('Mindestmenge');
    expect(mapping.quantity).toBe('Anzahl');
  });
});

describe('buildImportRows', () => {
  const mapping = {
    name: 'Name',
    itemType: 'Typ',
    quantity: 'Bestand',
    targetStock: 'Ziel',
    purchasePriceCents: 'EK',
    salePriceCents: 'VK',
    isBillable: 'Abrechenbar',
    notes: 'Notiz',
  };

  test('reads values through the mapping and parses types, money and booleans', () => {
    const [row] = buildImportRows(
      [
        {
          Name: 'Bohrmaschine',
          Typ: 'Werkzeug',
          Bestand: '1,5',
          Ziel: '',
          EK: '1.234,56 €',
          VK: '12.50',
          Abrechenbar: 'ja',
          Notiz: '',
        },
      ],
      mapping,
    );
    expect(row).toEqual({
      name: 'Bohrmaschine',
      itemType: 'tool',
      categoryName: null,
      locationName: null,
      unit: null,
      quantity: 1.5,
      minimumStock: 0,
      targetStock: null,
      internalSku: null,
      barcode: null,
      manufacturer: null,
      supplierName: null,
      supplierArticleNumber: null,
      purchasePriceCents: 123456,
      salePriceCents: 1250,
      isBillable: true,
      notes: null,
    });
  });

  test('falls back to material, unknown booleans and missing prices', () => {
    const [row] = buildImportRows(
      [
        {
          Name: 'Kupferrohr',
          Typ: 'Rohr',
          Bestand: 'x',
          Ziel: '7',
          EK: 'abc',
          VK: '',
          Abrechenbar: 'vielleicht',
          Notiz: 'Lager 2',
        },
      ],
      mapping,
    );
    expect(row).toMatchObject({
      itemType: 'material',
      quantity: 0,
      targetStock: 7,
      purchasePriceCents: null,
      salePriceCents: null,
      isBillable: null,
      notes: 'Lager 2',
    });
  });

  test('maps device and consumable types', () => {
    const rows = buildImportRows(
      [
        { Name: 'A', Typ: 'Gerät' },
        { Name: 'B', Typ: 'Verbrauchsmaterial' },
        { Name: 'C', Typ: '' },
      ],
      mapping,
    );
    expect(rows.map((row) => row.itemType)).toEqual(['asset', 'consumable', 'material']);
  });
});

describe('importResultBanner', () => {
  test('a complete import is a success', () => {
    expect(importResultBanner({ importedCount: 4, missingLocationCount: 0, failedCount: 0 })).toEqual({
      variant: 'success',
      message: '4 Artikel importiert.',
    });
  });

  test('rows without a Lager stay visible as an error with their own count', () => {
    expect(importResultBanner({ importedCount: 2, missingLocationCount: 3, failedCount: 0 })).toEqual({
      variant: 'error',
      message:
        '2 Artikel importiert. 3 Zeilen ohne Lager: Artikel übernommen, kein Bestand gebucht. Prüfe die CSV-Datei.',
    });
  });

  test('failed rows and a row without a Lager are named together', () => {
    expect(importResultBanner({ importedCount: 2, missingLocationCount: 1, failedCount: 1 })).toEqual({
      variant: 'error',
      message:
        '2 Artikel importiert, 1 Zeile konnte nicht übernommen werden. 1 Zeile ohne Lager: Artikel übernommen, kein Bestand gebucht. Prüfe die CSV-Datei.',
    });
  });
});

describe('importInventoryRowsSchema', () => {
  const input = { fileName: 'inventar.csv', rows: [{ name: 'Kupferrohr' }] };

  test('accepts a mapping of every import column and refuses a key outside them', () => {
    const columnMapping = Object.fromEntries(IMPORT_COLUMNS.map((column) => [column.key, column.label]));
    expect(importInventoryRowsSchema.safeParse({ ...input, columnMapping }).success).toBe(true);
    expect(
      importInventoryRowsSchema.safeParse({ ...input, columnMapping: { ...columnMapping, extra: 'Spalte' } })
        .success,
    ).toBe(false);
  });
});
