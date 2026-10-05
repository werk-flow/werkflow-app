import type { InventoryImportRow } from '@/lib/inventory/actions';
import type { InventoryItemType } from '@/lib/inventory/types';
import { parseDecimalInput } from '@/lib/ui/decimal';

type ImportColumnKey = keyof InventoryImportRow;

export type ImportColumnMapping = Partial<Record<ImportColumnKey, string | undefined>>;

export const IMPORT_COLUMNS: Array<{ key: ImportColumnKey; label: string }> = [
  { key: 'name', label: 'Artikelname' },
  { key: 'itemType', label: 'Typ' },
  { key: 'categoryName', label: 'Kategorie' },
  { key: 'locationName', label: 'Lager' },
  { key: 'unit', label: 'Einheit' },
  { key: 'quantity', label: 'Bestand' },
  { key: 'minimumStock', label: 'Mindestbestand' },
  { key: 'targetStock', label: 'Zielbestand' },
  { key: 'internalSku', label: 'Interne SKU' },
  { key: 'barcode', label: 'Barcode' },
  { key: 'manufacturer', label: 'Hersteller' },
  { key: 'supplierName', label: 'Lieferant' },
  { key: 'supplierArticleNumber', label: 'Lieferanten-Nr.' },
  { key: 'purchasePriceCents', label: 'Einkaufspreis' },
  { key: 'salePriceCents', label: 'Verkaufspreis' },
  { key: 'isBillable', label: 'Abrechenbar' },
  { key: 'notes', label: 'Notizen' },
];

function parseCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index++;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((line) => line.trim().length > 0);

  const [firstLine] = lines;
  if (firstLine === undefined) return { headers: [], rows: [] };
  const delimiter = parseCsvLine(firstLine, ';').length >= parseCsvLine(firstLine, ',').length ? ';' : ',';
  const headers = parseCsvLine(firstLine, delimiter).map((header) => header.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = parseCsvLine(line, delimiter);
    return headers.reduce<Record<string, string>>((acc, header, index) => {
      acc[header] = cells[index] ?? '';
      return acc;
    }, {});
  });

  return { headers, rows };
}

// Substring needles per column, the more specific columns first: a header
// claimed by one column is not guessed for a later one, so "Mindestbestand"
// never becomes the quantity and "Artikelnummer" never the name.
const COLUMN_NEEDLES: Array<{ key: ImportColumnKey; needles: string[] }> = [
  { key: 'targetStock', needles: ['zielbestand', 'sollbestand'] },
  { key: 'minimumStock', needles: ['mindest', 'minimum'] },
  { key: 'supplierArticleNumber', needles: ['lieferanten', 'lieferantennr'] },
  { key: 'internalSku', needles: ['sku', 'artikelnummer', 'nr.'] },
  { key: 'name', needles: ['artikel', 'name', 'bezeichnung', 'produkt'] },
  { key: 'itemType', needles: ['typ'] },
  { key: 'categoryName', needles: ['kategorie', 'gruppe'] },
  { key: 'locationName', needles: ['lager', 'ort', 'standort'] },
  { key: 'unit', needles: ['einheit', 'unit'] },
  { key: 'quantity', needles: ['bestand', 'menge', 'anzahl'] },
  { key: 'barcode', needles: ['barcode', 'ean', 'gtin'] },
  { key: 'manufacturer', needles: ['hersteller', 'manufacturer'] },
  { key: 'supplierName', needles: ['lieferant', 'supplier'] },
  { key: 'purchasePriceCents', needles: ['einkauf', 'ek'] },
  { key: 'salePriceCents', needles: ['verkauf', 'vk'] },
  { key: 'isBillable', needles: ['abrechenbar'] },
  { key: 'notes', needles: ['notiz', 'bemerkung'] },
];

// Whole-header aliases that would match too much as substrings.
const EXACT_ALIASES: Partial<Record<ImportColumnKey, string[]>> = { itemType: ['art'] };

/** Exact column labels and aliases first, then substring needles over the headers still free. */
export function guessMapping(headers: string[]): ImportColumnMapping {
  const lowerHeaders = headers.map((header) => ({ original: header, lower: header.trim().toLowerCase() }));
  const mapping: ImportColumnMapping = {};
  const claimed = new Set<string>();
  const claim = (key: ImportColumnKey, matches: (lower: string) => boolean) => {
    if (mapping[key] !== undefined) return;
    const header = lowerHeaders.find(({ original, lower }) => !claimed.has(original) && matches(lower));
    if (!header) return;
    mapping[key] = header.original;
    claimed.add(header.original);
  };

  for (const { key, label } of IMPORT_COLUMNS) {
    const exact = [label.toLowerCase(), ...(EXACT_ALIASES[key] ?? [])];
    claim(key, (lower) => exact.includes(lower));
  }
  for (const { key, needles } of COLUMN_NEEDLES) {
    claim(key, (lower) => needles.some((needle) => lower.includes(needle)));
  }
  return mapping;
}

function parseItemType(value: string): InventoryItemType {
  const normalized = value.toLowerCase();
  if (normalized.includes('werkzeug') || normalized.includes('tool')) return 'tool';
  if (normalized.includes('anlage') || normalized.includes('gerät') || normalized.includes('asset')) {
    return 'asset';
  }
  if (normalized.includes('verbrauch')) return 'consumable';
  return 'material';
}

function parseBoolean(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (['ja', 'j', 'yes', 'true', '1'].includes(normalized)) return true;
  if (['nein', 'n', 'no', 'false', '0'].includes(normalized)) return false;
  return null;
}

function parseMoneyToCents(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, '').replace('EUR', '').replace('€', '');
  if (!normalized) return null;

  const usesDotDecimal = !normalized.includes(',') && /^[+-]?\d+\.\d{1,2}$/.test(normalized);
  const cleaned = usesDotDecimal ? normalized : normalized.replace(/\./g, '').replace(',', '.');
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round(parsed * 100));
}

/** Reads every parsed CSV row through the chosen column mapping. */
export function buildImportRows(
  rows: Record<string, string>[],
  mapping: ImportColumnMapping,
): InventoryImportRow[] {
  return rows.map((row) => {
    const read = (key: ImportColumnKey) => {
      const header = mapping[key];
      return header ? (row[header] ?? '') : '';
    };

    return {
      name: read('name'),
      itemType: read('itemType') ? parseItemType(read('itemType')) : 'material',
      categoryName: read('categoryName') || null,
      locationName: read('locationName') || null,
      unit: read('unit') || null,
      quantity: parseDecimalInput(read('quantity')),
      minimumStock: parseDecimalInput(read('minimumStock')),
      targetStock: read('targetStock') ? parseDecimalInput(read('targetStock')) : null,
      internalSku: read('internalSku') || null,
      barcode: read('barcode') || null,
      manufacturer: read('manufacturer') || null,
      supplierName: read('supplierName') || null,
      supplierArticleNumber: read('supplierArticleNumber') || null,
      purchasePriceCents: parseMoneyToCents(read('purchasePriceCents')),
      salePriceCents: parseMoneyToCents(read('salePriceCents')),
      isBillable: parseBoolean(read('isBillable')),
      notes: read('notes') || null,
    };
  });
}

type ImportCounts = { importedCount: number; missingLocationCount: number; failedCount: number };

/** The banner after an import run. A row whose quantity was not booked or that failed keeps it open as an error. */
export function importResultBanner({ importedCount, missingLocationCount, failedCount }: ImportCounts): {
  variant: 'success' | 'error';
  message: string;
} {
  const importedLabel = `${importedCount} Artikel importiert`;
  if (missingLocationCount === 0 && failedCount === 0)
    return { variant: 'success', message: `${importedLabel}.` };

  const failedLabel = `${failedCount} ${failedCount === 1 ? 'Zeile konnte' : 'Zeilen konnten'} nicht übernommen werden`;
  const sentences = [failedCount > 0 ? `${importedLabel}, ${failedLabel}.` : `${importedLabel}.`];
  if (missingLocationCount > 0) {
    sentences.push(
      `${missingLocationCount} ${missingLocationCount === 1 ? 'Zeile' : 'Zeilen'} ohne Lager: Artikel übernommen, kein Bestand gebucht.`,
    );
  }
  sentences.push('Prüfe die CSV-Datei.');
  return { variant: 'error', message: sentences.join(' ') };
}
