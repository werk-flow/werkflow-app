import { describeFailure } from '@/lib/action-messages';
import type { UpsertInventoryItemInput } from '@/lib/inventory/actions';
import type { InventoryItemType, InventoryLocationType, InventoryOverviewItem } from '@/lib/inventory/types';
import { NEW_SUPPLIER_VALUE } from './supplier-quick-create-dialog';
import { parseDecimalInput } from '@/lib/ui/decimal';

export type ItemFormState = {
  id: string | null;
  name: string;
  itemType: InventoryItemType;
  description: string;
  categoryId: string;
  unit: string;
  internalSku: string;
  manufacturer: string;
  supplierId: string;
  supplierName: string;
  supplierArticleNumber: string;
  purchasePrice: string;
  salePrice: string;
  isBillable: boolean;
  globalMinimumStock: string;
  globalTargetStock: string;
  initialLocationId: string;
  initialQuantity: string;
  barcode: string;
  notes: string;
};

export type LocationFormState = {
  name: string;
  description: string;
  locationType: InventoryLocationType;
};

export type StockDialogState = {
  item: InventoryOverviewItem;
  locationId: string;
  direction: 'add' | 'remove';
  quantity: string;
  reason: string;
} | null;

// What the list shows for a record the user just created, until the refreshed
// server list carries it (feedback canon: create from a dialog).
export type PendingItemDraft = {
  confirmedId: string | null;
  name: string;
  internalSku: string;
  itemType: InventoryItemType;
  unit: string;
  quantity: number;
  locationName: string | null;
};

export const NONE_VALUE = '__none__';

export const EMPTY_ITEM_FORM: ItemFormState = {
  id: null,
  name: '',
  itemType: 'material',
  description: '',
  categoryId: NONE_VALUE,
  unit: 'piece',
  internalSku: '',
  manufacturer: '',
  supplierId: NONE_VALUE,
  supplierName: '',
  supplierArticleNumber: '',
  purchasePrice: '',
  salePrice: '',
  isBillable: true,
  globalMinimumStock: '0',
  globalTargetStock: '',
  initialLocationId: '',
  initialQuantity: '',
  barcode: '',
  notes: '',
};

export const EMPTY_LOCATION_FORM: LocationFormState = {
  name: '',
  description: '',
  locationType: 'room',
};

const NON_NEGATIVE_DECIMAL = /^\d+(\.\d+)?$/;

/** A de-DE amount with a decimal comma may carry dots as thousands separators. */
function normalizeDecimalText(value: string): string {
  const trimmed = value.trim();
  return trimmed.includes(',') ? trimmed.replaceAll('.', '').replace(',', '.') : trimmed;
}

function centsFromInput(value: string): number | null {
  const normalized = normalizeDecimalText(value);
  if (!NON_NEGATIVE_DECIMAL.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

function isValidDecimalText(value: string): boolean {
  return value.trim() === '' || NON_NEGATIVE_DECIMAL.test(normalizeDecimalText(value));
}

// Cents hold two fractional digits; "1.234" (meant as 1234) must be rejected,
// not stored as 1,23 €.
const PRICE_DECIMAL = /^\d+(\.\d{1,2})?$/;

function isValidPriceText(value: string): boolean {
  return value.trim() === '' || PRICE_DECIMAL.test(normalizeDecimalText(value));
}

const PRICE_INVALID_MESSAGE = 'Bitte gib einen gültigen Preis ein, zum Beispiel 12,50.';
const STOCK_INVALID_MESSAGE = 'Bitte gib eine gültige Menge ein, zum Beispiel 5 oder 2,5.';

/**
 * Errors of the item dialog's number fields, keyed by control id in visual
 * order. A text that is no non-negative number must not save as empty or 0.
 */
export function getItemNumberFieldErrors(form: ItemFormState): {
  'inventory-item-minimum-stock': string | undefined;
  'inventory-item-target-stock': string | undefined;
  'inventory-item-purchase-price': string | undefined;
  'inventory-item-sale-price': string | undefined;
} {
  return {
    'inventory-item-minimum-stock': isValidDecimalText(form.globalMinimumStock)
      ? undefined
      : STOCK_INVALID_MESSAGE,
    'inventory-item-target-stock': isValidDecimalText(form.globalTargetStock)
      ? undefined
      : STOCK_INVALID_MESSAGE,
    'inventory-item-purchase-price': isValidPriceText(form.purchasePrice) ? undefined : PRICE_INVALID_MESSAGE,
    'inventory-item-sale-price': isValidPriceText(form.salePrice) ? undefined : PRICE_INVALID_MESSAGE,
  };
}

function centsToInput(cents: number | null): string {
  if (cents === null) return '';
  return String(cents / 100).replace('.', ',');
}

export function itemToForm(item: InventoryOverviewItem): ItemFormState {
  return {
    ...EMPTY_ITEM_FORM,
    id: item.id,
    name: item.name,
    itemType: item.itemType,
    description: item.description ?? '',
    categoryId: item.categoryId ?? NONE_VALUE,
    unit: item.unit,
    internalSku: item.internalSku ?? '',
    manufacturer: item.manufacturer ?? '',
    supplierId: item.supplierId ?? NONE_VALUE,
    supplierArticleNumber: item.supplierArticleNumber ?? '',
    purchasePrice: centsToInput(item.purchasePriceCents),
    salePrice: centsToInput(item.salePriceCents),
    isBillable: item.isBillable,
    globalMinimumStock: String(item.globalMinimumStock).replace('.', ','),
    globalTargetStock:
      item.globalTargetStock === null ? '' : String(item.globalTargetStock).replace('.', ','),
    initialLocationId: '',
    initialQuantity: '',
    barcode: item.primaryBarcode ?? '',
    notes: item.notes ?? '',
  };
}

export function getInventoryActionErrorMessage(error: string): string {
  const messages: Record<string, string> = {
    name_required: 'Bitte gib einen Namen ein.',
    unit_required: 'Bitte wähle eine Einheit aus.',
    location_required_for_initial_stock:
      'Bitte wähle zuerst ein Lager aus oder lege direkt in diesem Feld ein neues Lager an.',
    location_required: 'Bitte wähle ein Lager aus.',
    location_not_found: 'Das ausgewählte Lager wurde nicht gefunden.',
    category_not_found: 'Die ausgewählte Kategorie wurde nicht gefunden.',
    supplier_not_found: 'Der ausgewählte Lieferant wurde nicht gefunden.',
    item_not_found: 'Der Artikel wurde nicht gefunden.',
    barcode_taken: 'Dieser Barcode gehört schon zu einem anderen Artikel.',
    quantity_required: 'Bitte gib eine Menge größer als 0 ein.',
    stock_would_go_negative:
      'Der Bestand in diesem Lager reicht nicht aus. Wähle eine kleinere Menge oder ein anderes Lager.',
    save_failed: 'Der Artikel konnte nicht gespeichert werden.',
    create_failed: 'Das Lager konnte nicht gespeichert werden.',
  };

  return describeFailure(error, messages, 'Die Aktion konnte nicht abgeschlossen werden.');
}

/** The save payload of the item form; only a create carries the start stock. */
export function buildItemSaveInput(
  itemForm: ItemFormState,
  initialQuantity: number,
): UpsertInventoryItemInput {
  return {
    ...(itemForm.id !== null ? { id: itemForm.id } : {}),
    name: itemForm.name,
    itemType: itemForm.itemType,
    description: itemForm.description,
    categoryId: itemForm.categoryId === NONE_VALUE ? null : itemForm.categoryId,
    unit: itemForm.unit,
    internalSku: itemForm.internalSku,
    manufacturer: itemForm.manufacturer,
    supplierId:
      itemForm.supplierId === NONE_VALUE || itemForm.supplierId === NEW_SUPPLIER_VALUE
        ? null
        : itemForm.supplierId,
    supplierName: itemForm.supplierId === NEW_SUPPLIER_VALUE ? itemForm.supplierName : null,
    supplierArticleNumber: itemForm.supplierArticleNumber,
    purchasePriceCents: centsFromInput(itemForm.purchasePrice),
    salePriceCents: centsFromInput(itemForm.salePrice),
    isBillable: itemForm.isBillable,
    globalMinimumStock: parseDecimalInput(normalizeDecimalText(itemForm.globalMinimumStock)),
    globalTargetStock: itemForm.globalTargetStock.trim()
      ? parseDecimalInput(normalizeDecimalText(itemForm.globalTargetStock))
      : null,
    trackQuantity: true,
    trackIndividualAssets: itemForm.itemType === 'tool' || itemForm.itemType === 'asset',
    barcode: itemForm.barcode,
    notes: itemForm.notes,
    initialLocationId: itemForm.id ? null : itemForm.initialLocationId || null,
    initialQuantity: itemForm.id ? null : initialQuantity,
  };
}
