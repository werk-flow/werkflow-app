import { describe, expect, test } from 'bun:test';
import { INVENTORY_IMPORT_MAX_ROWS } from './action-inputs';
import { previewInventoryImportSchema } from './action-schemas';
import {
  buildImportRows,
  guessMapping,
  IMPORT_COLUMNS,
  importReportCsv,
  importResultMessage,
  importRowEffect,
  importRowProblem,
  importTotals,
  parseCsv,
  type ImportRowOutcome,
} from './csv-import';

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
      // The blank line 3 is no row; each row keeps its line in the file.
      lineNumbers: [2, 4],
    });
  });

  test('detects the comma delimiter when it splits the header further', () => {
    expect(parseCsv('Name,Menge\nVentil,3')).toEqual({
      ok: true,
      headers: ['Name', 'Menge'],
      rows: [{ Name: 'Ventil', Menge: '3' }],
      lineNumbers: [2],
    });
  });

  test('an empty file has no headers and no rows', () => {
    expect(parseCsv('\n\n')).toEqual({ ok: true, headers: [], rows: [], lineNumbers: [] });
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

const BASE: ImportRowOutcome = {
  index: 0,
  outcome: 'booked',
  matchedBy: null,
  itemName: 'Pressfitting 15 mm',
  unit: 'piece',
  locationName: 'Hauptlager',
  locationCreated: false,
  quantity: 10,
  quantityAfter: 10,
  reason: null,
  itemUnit: null,
};

// A synthetic file of Großhandel Nordrohr as the preview answers it.
const OUTCOMES: ImportRowOutcome[] = [
  BASE,
  {
    ...BASE,
    index: 1,
    matchedBy: 'internal_sku',
    itemName: 'Kupferrohr 15 mm',
    unit: 'meter',
    quantity: 0.1,
    quantityAfter: 4.1,
  },
  {
    ...BASE,
    index: 2,
    matchedBy: 'barcode',
    unit: 'meter',
    quantity: 0.2,
    locationName: 'Regal Nord',
    locationCreated: true,
    quantityAfter: 0.2,
  },
  { ...BASE, index: 3, matchedBy: 'internal_sku', unit: 'meter', quantity: 0.2, quantityAfter: 4.3 },
  {
    ...BASE,
    index: 4,
    outcome: 'rejected',
    reason: 'unit_mismatch',
    unit: 'piece',
    itemUnit: 'meter',
    quantityAfter: null,
  },
  {
    ...BASE,
    index: 5,
    outcome: 'rejected',
    reason: 'unknown_unit',
    itemName: null,
    unit: 'Fass',
    quantityAfter: null,
  },
  { ...BASE, index: 6, outcome: 'missing_location', locationName: null, quantityAfter: null },
  { ...BASE, index: 7, outcome: 'rejected', reason: 'missing_name', itemName: null, quantityAfter: null },
];

describe('importTotals', () => {
  test('every row counts once as new, matched or rejected, and each Lager sums its stock per unit', () => {
    const totals = importTotals(OUTCOMES);
    expect(totals.created + totals.matched + totals.rejected).toBe(OUTCOMES.length);
    expect(totals).toEqual({
      created: 2,
      matched: 3,
      rejected: 3,
      withoutLocation: 1,
      locations: [
        {
          locationName: 'Hauptlager',
          isNew: false,
          // 0,1 m + 0,2 m stays 0,3 m.
          quantities: [
            { unit: 'piece', quantity: 10 },
            { unit: 'meter', quantity: 0.3 },
          ],
        },
        { locationName: 'Regal Nord', isNew: true, quantities: [{ unit: 'meter', quantity: 0.2 }] },
      ],
    });
  });

  test('an empty preview has no totals', () => {
    expect(importTotals([])).toEqual({
      created: 0,
      matched: 0,
      rejected: 0,
      withoutLocation: 0,
      locations: [],
    });
  });
});

describe('importRowEffect and importRowProblem', () => {
  test('a quantity keeps the three decimal places the ledger books', () => {
    expect(importRowEffect({ ...BASE, unit: 'meter', quantity: 0.001, quantityAfter: 4.125 }, 'stock')).toBe(
      '+0,001 Meter in Hauptlager, danach 4,125 Meter',
    );
  });

  test('a matched row says its quantity adds to the stock it already has', () => {
    expect(importRowEffect(OUTCOMES[1] ?? BASE, 'stock')).toBe(
      '+0,1 Meter zum vorhandenen Bestand in Hauptlager, danach 4,1 Meter',
    );
    expect(importRowEffect(OUTCOMES[2] ?? BASE, 'stock')).toBe(
      '+0,2 Meter zum vorhandenen Bestand in Regal Nord (neues Lager), danach 0,2 Meter',
    );
    expect(importRowEffect({ ...BASE, outcome: 'imported' }, 'master_data')).toBe(
      'Nur Stammdaten: kein Bestand gebucht',
    );
  });

  test('a rejected row names its reason with the unit it carried', () => {
    expect(importRowProblem(OUTCOMES[4] ?? BASE, 'Stk')).toBe('Einheit weicht ab: Stück statt Meter.');
    expect(importRowProblem(OUTCOMES[5] ?? BASE, ' Fass ')).toBe('Unbekannte Einheit: „Fass“.');
    expect(importRowProblem(OUTCOMES[5] ?? BASE, '')).toBe('Keine Einheit angegeben.');
    expect(importRowProblem(OUTCOMES[6] ?? BASE, 'Stk')).toBe(
      'Kein Lager angegeben: Artikel übernommen, kein Bestand gebucht.',
    );
    expect(importRowProblem({ ...BASE, outcome: 'rejected', reason: 'changed_since_preview' }, 'Stk')).toBe(
      'Der Artikel hat sich seit der Vorschau geändert. Importiere die Zeile erneut und prüfe die neue Vorschau.',
    );
    expect(importRowProblem(BASE, 'Stk')).toBeNull();
  });
});

/** The report's text with its byte order mark, as a spreadsheet reads it. */
function readReport(bytes: Uint8Array | null): string | null {
  return bytes === null ? null : new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
}

describe('importReportCsv', () => {
  const headers = ['Bezeichnung', 'Einheit'];
  const rows = OUTCOMES.map((_, index) => ({ Bezeichnung: `Artikel; ${index}`, Einheit: 'Stk' }));
  const lineNumbers = OUTCOMES.map((_, index) => index + 3);
  const fileUnits = OUTCOMES.map(() => 'Stk');

  test('holds every rejected row and every row without a Lager with its line, cells and reason', () => {
    const csv = readReport(importReportCsv({ headers, rows, lineNumbers, outcomes: OUTCOMES, fileUnits }));
    expect(csv?.split('\r\n')).toEqual([
      '﻿Zeile;Bezeichnung;Einheit;Importhinweis',
      '7;"Artikel; 4";Stk;Einheit weicht ab: Stück statt Meter.',
      '8;"Artikel; 5";Stk;Unbekannte Einheit: „Stk“.',
      '9;"Artikel; 6";Stk;Kein Lager angegeben: Artikel übernommen, kein Bestand gebucht.',
      '10;"Artikel; 7";Stk;Kein Artikelname.',
      '',
    ]);
  });

  test('a cell or header that starts like a formula reaches the report as text', () => {
    const formulaRows = OUTCOMES.map(() => ({ '+Bezeichnung': '=HYPERLINK("x")', Einheit: '@Stk' }));
    const csv = readReport(
      importReportCsv({
        headers: ['+Bezeichnung', 'Einheit'],
        rows: formulaRows,
        lineNumbers,
        outcomes: OUTCOMES.slice(4, 5),
        fileUnits,
      }),
    );
    expect(csv?.split('\r\n')).toEqual([
      "\uFEFFZeile;'+Bezeichnung;Einheit;Importhinweis",
      `7;"'=HYPERLINK(""x"")";'@Stk;Einheit weicht ab: Stück statt Meter.`,
      '',
    ]);
  });

  test('a file without a problem row has no report', () => {
    expect(
      importReportCsv({ headers, rows, lineNumbers, outcomes: OUTCOMES.slice(0, 4), fileUnits }),
    ).toBeNull();
  });
});

describe('importResultMessage', () => {
  test('names the new and the matched articles', () => {
    expect(importResultMessage(importTotals(OUTCOMES.slice(0, 2)))).toBe(
      'Import gebucht: 1 neuer Artikel, 1 vorhandener Artikel.',
    );
  });
});

describe('previewInventoryImportSchema', () => {
  const input = {
    fileName: 'inventar.csv',
    contentHash: 'a'.repeat(64),
    mode: 'stock',
    rows: [{ name: 'Kupferrohr' }],
  };

  test('accepts a mapping of every import column and refuses a key outside them', () => {
    const columnMapping = Object.fromEntries(IMPORT_COLUMNS.map((column) => [column.key, column.label]));
    expect(previewInventoryImportSchema.safeParse({ ...input, columnMapping }).success).toBe(true);
    expect(
      previewInventoryImportSchema.safeParse({
        ...input,
        columnMapping: { ...columnMapping, extra: 'Spalte' },
      }).success,
    ).toBe(false);
  });

  test('refuses a hash that is no SHA-256 and a mode outside the list', () => {
    expect(
      previewInventoryImportSchema.safeParse({ ...input, columnMapping: {}, contentHash: 'abc' }).success,
    ).toBe(false);
    expect(
      previewInventoryImportSchema.safeParse({ ...input, columnMapping: {}, mode: 'transfer' }).success,
    ).toBe(false);
  });
});
