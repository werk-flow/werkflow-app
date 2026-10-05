import { describeFailure } from '@/lib/action-messages';
import type { InventoryLocation, InventoryPickerOption, JobMaterialLine } from '@/lib/inventory/types';
import { formatInventoryQuantity, INVENTORY_ITEM_TYPE_LABELS } from '@/lib/inventory/types';
import { parseDecimalInput } from '@/lib/ui/decimal';
import { normalizeSearchText } from '@/lib/ui/search';

export type MaterialDialogMode = 'plan' | 'take' | 'return' | 'edit';

export type MaterialDialogRow = {
  key: string;
  lineId: string | null;
  itemId: string;
  locationId: string;
  quantity: string;
  notes: string;
  takenQuantity: number;
  returnedQuantity: number;
};

export type MaterialDialogState = {
  mode: MaterialDialogMode;
  rows: MaterialDialogRow[];
  search: string;
  error: string | null;
};

type ValidatedMaterialRow = { row: MaterialDialogRow; quantity: number };

export const NO_LOCATION_VALUE = '__no_location__';

// Quantities are stored with three fractional digits (numeric(12,3)); a
// prefill must keep them, or a dialog would save a rounded quantity.
function quantityToInput(quantity: number): string {
  return Number.isInteger(quantity)
    ? String(quantity)
    : quantity.toLocaleString('de-DE', {
        maximumFractionDigits: 3,
        useGrouping: false,
      });
}

const MODE_FAILURE_MESSAGES: Record<MaterialDialogMode, string> = {
  plan: 'Das Material konnte nicht geplant werden.',
  take: 'Die Entnahme konnte nicht gebucht werden.',
  return: 'Die Rückgabe konnte nicht gebucht werden.',
  edit: 'Die Materialposition konnte nicht geändert werden.',
};

export function getActionErrorMessage(error: string, mode: MaterialDialogMode): string {
  const messages: Record<string, string> = {
    item_required: 'Bitte wähle mindestens einen Artikel aus.',
    quantity_required: 'Bitte gib eine Menge größer als 0 ein.',
    location_required: 'Bitte wähle ein Lager mit Bestand aus.',
    stock_would_go_negative:
      'Der Bestand in diesem Lager reicht nicht aus. Wähle eine kleinere Menge oder ein anderes Lager.',
    return_exceeds_taken: 'Du kannst nicht mehr zurücklegen, als für diese Position entnommen wurde.',
    line_has_movements:
      'Der Artikel kann nicht mehr geändert werden, weil für diese Position bereits Entnahmen oder Rückgaben gebucht wurden.',
    item_not_found: 'Der ausgewählte Artikel wurde nicht gefunden.',
    location_not_found: 'Das ausgewählte Lager wurde nicht gefunden.',
    line_not_found: 'Die Materialposition wurde nicht gefunden.',
    create_failed: 'Die Materialposition konnte nicht gespeichert werden.',
    update_failed: 'Die Materialposition konnte nicht aktualisiert werden.',
    delete_failed: 'Die Materialposition konnte nicht entfernt werden.',
  };

  return describeFailure(error, messages, MODE_FAILURE_MESSAGES[mode]);
}

export function matchesItemSearch(item: InventoryPickerOption, search: string): boolean {
  if (!search.trim()) return true;
  const query = normalizeSearchText(search);
  return [
    item.name,
    item.internalSku,
    item.categoryName,
    item.manufacturer,
    item.supplierName,
    item.supplierArticleNumber,
    item.primaryBarcode,
    INVENTORY_ITEM_TYPE_LABELS[item.itemType],
    ...item.stockByLocation.map((stock) => stock.locationName),
  ]
    .filter(Boolean)
    .some((value) => (value ? value.toLocaleLowerCase('de-DE').includes(query) : false));
}

function getDefaultLocationId(
  item: InventoryPickerOption,
  locations: InventoryLocation[],
  mode: MaterialDialogMode,
  fallbackLocationId?: string | null,
): string {
  if (fallbackLocationId) return fallbackLocationId;
  if (mode === 'take') {
    return item.stockByLocation.find((stock) => stock.quantityOnHand > 0)?.locationId ?? '';
  }
  return item.stockByLocation[0]?.locationId ?? locations[0]?.id ?? '';
}

export function getLocationOptions(
  item: InventoryPickerOption | undefined,
  locations: InventoryLocation[],
  mode: MaterialDialogMode,
): Array<{ id: string; label: string }> {
  if (!item) return [];
  if (mode === 'take') {
    return item.stockByLocation
      .filter((stock) => stock.quantityOnHand > 0)
      .map((stock) => ({
        id: stock.locationId,
        label: `${stock.locationName} · ${formatInventoryQuantity(stock.quantityOnHand, item.unit)}`,
      }));
  }

  if (mode === 'plan' || mode === 'edit') {
    const stockLocations = item.stockByLocation.map((stock) => ({
      id: stock.locationId,
      label: `${stock.locationName} · ${formatInventoryQuantity(stock.quantityOnHand, item.unit)}`,
    }));
    return stockLocations.length > 0
      ? stockLocations
      : locations.map((location) => ({ id: location.id, label: location.name }));
  }

  return locations.map((location) => ({ id: location.id, label: location.name }));
}

export function buildDialogRow(
  item: InventoryPickerOption,
  locations: InventoryLocation[],
  mode: MaterialDialogMode,
  line?: JobMaterialLine,
): MaterialDialogRow {
  const remainingPlanned = line ? Math.max(0, line.plannedQuantity - line.takenQuantity) : 0;
  const stillOut = line ? Math.max(0, line.takenQuantity - line.returnedQuantity) : 0;
  const defaultQuantity =
    mode === 'return' ? stillOut || 1 : mode === 'take' ? remainingPlanned || 1 : line?.plannedQuantity || 1;

  return {
    key: line?.id ?? `${item.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    lineId: line?.id ?? null,
    itemId: item.id,
    locationId: getDefaultLocationId(item, locations, mode, line?.preferredLocationId),
    quantity: quantityToInput(defaultQuantity),
    notes: line?.notes ?? '',
    takenQuantity: line?.takenQuantity ?? 0,
    returnedQuantity: line?.returnedQuantity ?? 0,
  };
}

export function itemFromLine(line: JobMaterialLine): InventoryPickerOption {
  return {
    id: line.itemId,
    itemType: line.itemType,
    name: line.itemName,
    unit: line.unit,
    internalSku: null,
    manufacturer: null,
    supplierName: null,
    supplierArticleNumber: null,
    primaryBarcode: null,
    categoryName: line.categoryName,
    isBillable: line.isBillable,
    availableQuantity: line.availableQuantity,
    stockByLocation: [],
  };
}

/** The dialog's heading and explanation for a mode. */
export function getMaterialDialogCopy(mode: MaterialDialogMode): {
  title: string;
  description: string;
} {
  const title =
    mode === 'plan'
      ? 'Material planen'
      : mode === 'take'
        ? 'Entnahme buchen'
        : mode === 'return'
          ? 'Material zurücklegen'
          : 'Materialposition bearbeiten';
  const description =
    mode === 'plan'
      ? 'Geplante Mengen beschreiben den Bedarf. Der Lagerbestand bleibt unverändert.'
      : mode === 'take'
        ? 'Diese Buchung zieht die gewählte Menge aus dem ausgewählten Lager ab.'
        : mode === 'return'
          ? 'Diese Buchung legt Material zurück und erhöht den Lagerbestand.'
          : 'Ändere Artikel, Lager, Menge oder Notiz der geplanten Position.';
  return { title, description };
}

/**
 * Adds a picked item to the dialog rows: a single-row mode swaps the item,
 * an item that is already listed gains one unit, a new item gets its own row.
 */
export function addItemToDialogRows(
  rows: MaterialDialogRow[],
  item: InventoryPickerOption,
  context: { locations: InventoryLocation[]; mode: MaterialDialogMode; canAddMultiple: boolean },
): MaterialDialogRow[] {
  const { locations, mode, canAddMultiple } = context;
  const existing = rows[0];
  if (!canAddMultiple && existing) {
    return [
      {
        ...existing,
        itemId: item.id,
        locationId: getDefaultLocationId(item, locations, mode),
      },
    ];
  }

  if (rows.some((row) => row.itemId === item.id)) {
    return rows.map((row) =>
      row.itemId === item.id
        ? {
            ...row,
            quantity: quantityToInput(parseDecimalInput(row.quantity) + 1),
          }
        : row,
    );
  }

  return [...rows, buildDialogRow(item, locations, mode)];
}

/** Checks the dialog rows before booking; the first failing rule names the error code. */
export function validateDialogRows(
  dialog: MaterialDialogState,
): { ok: true; rows: ValidatedMaterialRow[] } | { ok: false; error: string } {
  if (dialog.rows.length === 0) return { ok: false, error: 'item_required' };

  const validatedRows: ValidatedMaterialRow[] = [];
  for (const row of dialog.rows) {
    const quantity = parseDecimalInput(row.quantity);
    if (!row.itemId) return { ok: false, error: 'item_required' };
    if (quantity <= 0) return { ok: false, error: 'quantity_required' };
    if ((dialog.mode === 'take' || dialog.mode === 'return') && !row.locationId) {
      return { ok: false, error: 'location_required' };
    }

    validatedRows.push({ row, quantity });
  }
  return { ok: true, rows: validatedRows };
}
