import { describe, expect, test } from 'bun:test';
import { buildImportRows, guessMapping, importResultBanner, parseCsv } from './csv-import';

describe('parseCsv', () => {
  test('detects the semicolon delimiter and keeps quoted delimiters and quotes', () => {
    const { headers, rows } = parseCsv(
      'Artikel;Bestand;Notiz\r\n"Rohr; 22 mm";4;"sagt ""ok"""\r\n\r\nMuffe;2\n',
    );
    expect(headers).toEqual(['Artikel', 'Bestand', 'Notiz']);
    expect(rows).toEqual([
      { Artikel: 'Rohr; 22 mm', Bestand: '4', Notiz: 'sagt "ok"' },
      { Artikel: 'Muffe', Bestand: '2', Notiz: '' },
    ]);
  });

  test('detects the comma delimiter when it splits the header further', () => {
    expect(parseCsv('Name,Menge\nVentil,3').rows).toEqual([{ Name: 'Ventil', Menge: '3' }]);
  });

  test('an empty file has no headers and no rows', () => {
    expect(parseCsv('\n\n')).toEqual({ headers: [], rows: [] });
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
