import { INVENTORY_IMPORT_MAX_ROWS, type InventoryImportRow } from '@/lib/inventory/action-inputs';
import {
  formatInventoryQuantity,
  getInventoryUnitLabel,
  type InventoryItemType,
} from '@/lib/inventory/types';
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

// A header wider than this is refused: each data row holds one cell per header,
// so a wide header over many short rows would build millions of empty cells.
// It leaves room for many unmapped columns beside the import columns.
const IMPORT_MAX_HEADER_COLUMNS = 200;

type ParsedCsv =
  | { ok: true; headers: string[]; rows: Record<string, string>[]; lineNumbers: number[] }
  | { ok: false; message: string };

/**
 * Reads a CSV file, or refuses it before building any row when it is longer or
 * wider than one import takes. `lineNumbers` holds each row's line in the file,
 * so a report names the line a user finds in the file.
 */
export function parseCsv(text: string): ParsedCsv {
  const numberedLines = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => line.trim().length > 0);
  const lines = numberedLines.map(({ line }) => line);

  const [firstLine] = lines;
  if (firstLine === undefined) return { ok: true, headers: [], rows: [], lineNumbers: [] };
  if (lines.length - 1 > INVENTORY_IMPORT_MAX_ROWS) {
    return {
      ok: false,
      message: `Die CSV-Datei hat mehr als ${INVENTORY_IMPORT_MAX_ROWS.toLocaleString('de-DE')} Datenzeilen. Teile sie auf mehrere Dateien auf und importiere sie nacheinander.`,
    };
  }
  const delimiter = parseCsvLine(firstLine, ';').length >= parseCsvLine(firstLine, ',').length ? ';' : ',';
  const headers = parseCsvLine(firstLine, delimiter).map((header) => header.trim());
  if (headers.length > IMPORT_MAX_HEADER_COLUMNS) {
    return {
      ok: false,
      message: `Die CSV-Datei hat mehr als ${IMPORT_MAX_HEADER_COLUMNS} Spalten. Lösche die Spalten, die du nicht importierst, und wähle die Datei erneut.`,
    };
  }
  const rows = lines.slice(1).map((line) => {
    const cells = parseCsvLine(line, delimiter);
    return headers.reduce<Record<string, string>>((acc, header, index) => {
      acc[header] = cells[index] ?? '';
      return acc;
    }, {});
  });

  return { ok: true, headers, rows, lineNumbers: numberedLines.slice(1).map(({ lineNumber }) => lineNumber) };
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

/** What the import does with the quantity column: book it, or only create articles. */
export const INVENTORY_IMPORT_MODES = ['stock', 'master_data'] as const;
export type InventoryImportMode = (typeof INVENTORY_IMPORT_MODES)[number];

/** Why a row is not imported; `failed` stands for any reason the import does not name. */
export const IMPORT_REJECTIONS = [
  'missing_name',
  'unknown_unit',
  'unit_mismatch',
  'barcode_taken',
  'invalid_input',
  'stock_not_tracked',
  'failed',
] as const;
type ImportRejection = (typeof IMPORT_REJECTIONS)[number];

/**
 * One row's effect as the preview answers it and the booking did it
 * (`preview_inventory_import`, `book_inventory_import`). `index` is the row's
 * position among the file's rows; `unit` is the unit as understood, and
 * `itemUnit` the matched article's unit when it differs.
 */
export type ImportRowOutcome = {
  index: number;
  outcome: 'booked' | 'imported' | 'missing_location' | 'rejected';
  matchedBy: 'internal_sku' | 'barcode' | null;
  itemName: string | null;
  unit: string | null;
  locationName: string | null;
  locationCreated: boolean;
  quantity: number;
  quantityAfter: number | null;
  reason: ImportRejection | null;
  itemUnit: string | null;
};

type ImportLocationTotal = {
  locationName: string;
  isNew: boolean;
  quantities: Array<{ unit: string; quantity: number }>;
};

export type ImportTotals = {
  created: number;
  matched: number;
  rejected: number;
  withoutLocation: number;
  locations: ImportLocationTotal[];
};

// Quantities are numeric(12,3); a sum keeps three digits so 0,1 + 0,2 stays 0,3.
function addQuantity(left: number, right: number): number {
  return Math.round((left + right) * 1000) / 1000;
}

/** The totals above the preview and the result: every row counts once as new, matched or rejected. */
export function importTotals(outcomes: readonly ImportRowOutcome[]): ImportTotals {
  const locations = new Map<string, ImportLocationTotal>();
  const totals: ImportTotals = { created: 0, matched: 0, rejected: 0, withoutLocation: 0, locations: [] };
  for (const row of outcomes) {
    if (row.outcome === 'rejected') {
      totals.rejected += 1;
      continue;
    }
    if (row.matchedBy === null) totals.created += 1;
    else totals.matched += 1;
    if (row.outcome === 'missing_location') totals.withoutLocation += 1;
    if (row.outcome !== 'booked' || row.locationName === null || row.unit === null) continue;
    const location = locations.get(row.locationName) ?? {
      locationName: row.locationName,
      isNew: false,
      quantities: [],
    };
    location.isNew ||= row.locationCreated;
    const unitTotal = location.quantities.find((entry) => entry.unit === row.unit);
    if (unitTotal) unitTotal.quantity = addQuantity(unitTotal.quantity, row.quantity);
    else location.quantities.push({ unit: row.unit, quantity: row.quantity });
    locations.set(row.locationName, location);
  }
  totals.locations = [...locations.values()];
  return totals;
}

/** What the row's quantity does, in the words of the preview; null for a rejected row. */
export function importRowEffect(row: ImportRowOutcome, mode: InventoryImportMode): string | null {
  if (row.outcome === 'rejected') return null;
  if (mode === 'master_data') return 'Nur Stammdaten: kein Bestand gebucht';
  if (row.outcome === 'missing_location') return null;
  if (row.outcome === 'imported' || row.unit === null || row.locationName === null) {
    return 'Menge 0: kein Bestand gebucht';
  }
  const place = row.locationCreated ? `${row.locationName} (neues Lager)` : row.locationName;
  const after =
    row.quantityAfter === null ? '' : `, danach ${formatInventoryQuantity(row.quantityAfter, row.unit)}`;
  const added = row.matchedBy === null ? '' : ' zum vorhandenen Bestand';
  return `+${formatInventoryQuantity(row.quantity, row.unit)}${added} in ${place}${after}`;
}

/**
 * Why a row is not imported as the file says, or null when it is: a rejected
 * row, or a row whose quantity has no Lager. `fileUnit` is the unit text the
 * row carried.
 */
export function importRowProblem(row: ImportRowOutcome, fileUnit: string | null): string | null {
  if (row.outcome === 'missing_location') {
    return 'Kein Lager angegeben: Artikel übernommen, kein Bestand gebucht.';
  }
  switch (row.reason) {
    case null:
      return null;
    case 'missing_name':
      return 'Kein Artikelname.';
    case 'unknown_unit':
      return fileUnit?.trim() ? `Unbekannte Einheit: „${fileUnit.trim()}“.` : 'Keine Einheit angegeben.';
    case 'unit_mismatch':
      return `Einheit weicht ab: ${getInventoryUnitLabel(row.unit ?? fileUnit ?? '')} statt ${getInventoryUnitLabel(row.itemUnit ?? '')}.`;
    case 'barcode_taken':
      return 'Der Barcode gehört schon zu einem anderen Artikel.';
    case 'invalid_input':
      return 'Die Zeile enthält eine ungültige Angabe.';
    case 'stock_not_tracked':
      return 'Für diesen Artikel wird kein Bestand geführt.';
    case 'failed':
      return 'Die Zeile konnte nicht übernommen werden.';
  }
}

function csvCell(value: string): string {
  return /[;"\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * The result report: every row that was not imported as the file says, with
 * its line, its original cells and why. Null when there is no such row. The
 * byte order mark lets a spreadsheet read the umlauts.
 */
export function importReportCsv({
  headers,
  rows,
  lineNumbers,
  outcomes,
  fileUnits,
}: {
  headers: string[];
  rows: Record<string, string>[];
  lineNumbers: number[];
  outcomes: readonly ImportRowOutcome[];
  fileUnits: ReadonlyArray<string | null>;
}): string | null {
  const lines = outcomes.flatMap((outcome) => {
    const problem = importRowProblem(outcome, fileUnits[outcome.index] ?? null);
    if (problem === null) return [];
    const row = rows[outcome.index] ?? {};
    const lineNumber = lineNumbers[outcome.index] ?? outcome.index + 2;
    return [[String(lineNumber), ...headers.map((header) => row[header] ?? ''), problem]];
  });
  if (lines.length === 0) return null;
  return `﻿${[['Zeile', ...headers, 'Importhinweis'], ...lines]
    .map((cells) => cells.map(csvCell).join(';'))
    .join('\r\n')}\r\n`;
}

/** The banner after a booking with no rejected row and no row without a Lager. */
export function importResultMessage(totals: ImportTotals): string {
  const created = `${totals.created} ${totals.created === 1 ? 'neuer Artikel' : 'neue Artikel'}`;
  const matched = `${totals.matched} ${totals.matched === 1 ? 'vorhandener Artikel' : 'vorhandene Artikel'}`;
  return `Import gebucht: ${created}, ${matched}.`;
}
