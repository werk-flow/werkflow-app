import { z } from '@/lib/zod';
import { boundedText, nullableBoundedText } from '@/lib/validation/text';
import { uuidSchema } from '@/lib/validation/uuid';
import { INVENTORY_IMPORT_MAX_ROWS } from '@/lib/inventory/action-inputs';
import { INVENTORY_IMPORT_MODES } from '@/lib/inventory/csv-import';
import { MAX_PRICE_CENTS } from '@/lib/price-catalog/money';
import { ARTICLE_PRICE_KINDS, PRICE_QUANTITIES } from './article-price-terms';
import { OFFERED_INVENTORY_UNITS } from './units';

// Boundary schemas of the inventory Server Actions: types, ids and bounds.
// The value rules inside the actions (names, units, quantities) keep their own
// error codes for the forms.

const optionalId = uuidSchema.nullable().optional();
const amount = z.number().finite();
const optionalAmount = amount.nullable().optional();

export const pickerSearchSchema = boundedText(200);
export const optionalItemIdSchema = uuidSchema.optional();

export const createInventoryLocationSchema = z.object({
  name: boundedText(200),
  description: nullableBoundedText(2000),
  locationType: boundedText(40).optional(),
  parentLocationId: optionalId,
});

export const upsertInventoryItemSchema = z.object({
  id: uuidSchema.optional(),
  name: boundedText(300),
  itemType: boundedText(40),
  description: nullableBoundedText(5000),
  categoryId: optionalId,
  unit: boundedText(40),
  internalSku: nullableBoundedText(200),
  manufacturer: nullableBoundedText(300),
  supplierId: optionalId,
  supplierName: nullableBoundedText(300),
  supplierArticleNumber: nullableBoundedText(200),
  purchasePriceCents: optionalAmount,
  salePriceCents: optionalAmount,
  isBillable: z.boolean(),
  globalMinimumStock: amount.optional(),
  globalTargetStock: optionalAmount,
  trackQuantity: z.boolean().optional(),
  trackIndividualAssets: z.boolean().optional(),
  barcode: nullableBoundedText(200),
  notes: nullableBoundedText(5000),
  initialLocationId: optionalId,
  initialQuantity: optionalAmount,
});

/** A quantity as `numeric(12,3)` holds it. */
const conversionQuantity = z.number().finite().max(999_999_999);

/** One supplier reference of an article: a supplier of the organization, or a new one by name. */
export const saveArticleSupplierSchema = z.object({
  itemId: uuidSchema,
  referenceId: uuidSchema.nullable(),
  supplierId: uuidSchema.nullable(),
  supplierName: nullableBoundedText(300),
  supplierArticleNumber: nullableBoundedText(200),
  // A unit the forms offer; null sells in the article's base unit.
  purchaseUnit: z
    .string()
    .refine((code) => OFFERED_INVENTORY_UNITS.some((unit) => unit.code === code))
    .nullable(),
  packQuantity: conversionQuantity,
  baseQuantity: conversionQuantity,
  isPreferred: z.boolean(),
});

export const removeArticleSupplierSchema = z.object({ referenceId: uuidSchema });

/** A price the office enters: cents per price quantity of base units, from a Berlin day on. */
export const addArticlePriceSchema = z.object({
  itemId: uuidSchema,
  kind: z.enum(ARTICLE_PRICE_KINDS),
  amountCents: z.number().int().min(0).max(MAX_PRICE_CENTS),
  priceQuantity: z.literal(PRICE_QUANTITIES),
  validFrom: z.iso.date(),
});

export type SaveArticleSupplierInput = z.input<typeof saveArticleSupplierSchema>;
export type RemoveArticleSupplierInput = z.input<typeof removeArticleSupplierSchema>;
export type AddArticlePriceInput = z.input<typeof addArticlePriceSchema>;

export const adjustInventoryStockSchema = z.object({
  itemId: uuidSchema,
  locationId: uuidSchema,
  direction: z.enum(['add', 'remove']).optional(),
  quantityDelta: amount.optional(),
  quantity: amount.optional(),
  reason: nullableBoundedText(2000),
});

const materialLineFields = {
  itemId: uuidSchema,
  preferredLocationId: optionalId,
  plannedQuantity: amount,
  notes: nullableBoundedText(2000),
};

export const createJobMaterialLineSchema = z.object({ ...materialLineFields, jobId: uuidSchema });
export const createProjectMaterialLineSchema = z.object({ ...materialLineFields, projectId: uuidSchema });

export const updateJobMaterialLineSchema = z.object({
  lineId: uuidSchema,
  itemId: uuidSchema.optional(),
  preferredLocationId: optionalId,
  plannedQuantity: amount.optional(),
  isBillable: z.boolean().optional(),
  notes: nullableBoundedText(2000),
});

const takeMaterialFields = {
  lineId: optionalId,
  itemId: optionalId,
  locationId: uuidSchema,
  quantity: amount,
  reason: nullableBoundedText(2000),
};

export const takeJobMaterialSchema = z.object({ ...takeMaterialFields, jobId: uuidSchema });
export const takeProjectMaterialSchema = z.object({ ...takeMaterialFields, projectId: uuidSchema });

export const returnJobMaterialSchema = z.object({
  lineId: uuidSchema,
  locationId: uuidSchema,
  quantity: amount,
  reason: nullableBoundedText(2000),
});

export const recordJobMaterialUseSchema = z.object({
  lineId: uuidSchema,
  quantity: amount,
  note: nullableBoundedText(2000),
});

export const materialConsumptionTargetSchema = z.union([
  z.object({ jobId: uuidSchema }),
  z.object({ projectId: uuidSchema }),
]);

const importRowSchema = z.object({
  name: boundedText(300),
  itemType: boundedText(40).optional(),
  categoryName: nullableBoundedText(200),
  locationName: nullableBoundedText(200),
  unit: nullableBoundedText(40),
  quantity: optionalAmount,
  minimumStock: optionalAmount,
  targetStock: optionalAmount,
  internalSku: nullableBoundedText(200),
  barcode: nullableBoundedText(200),
  manufacturer: nullableBoundedText(300),
  supplierName: nullableBoundedText(300),
  supplierArticleNumber: nullableBoundedText(200),
  purchasePriceCents: optionalAmount,
  salePriceCents: optionalAmount,
  isBillable: z.boolean().nullable().optional(),
  notes: nullableBoundedText(5000),
});

const contentHashSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const previewInventoryImportSchema = z.object({
  fileName: boundedText(300),
  // The SHA-256 of the file's bytes, which finds a repeated file.
  contentHash: contentHashSchema,
  mode: z.enum(INVENTORY_IMPORT_MODES),
  // Keyed by the row fields, so a client cannot send an unbounded mapping.
  columnMapping: z.partialRecord(importRowSchema.keyof(), boundedText(200)),
  // One spreadsheet import, every row of the file in its order.
  rows: z.array(importRowSchema).min(1).max(INVENTORY_IMPORT_MAX_ROWS),
});

export const bookInventoryImportSchema = z.object({ batchId: uuidSchema });

export const inventoryImportRepeatSchema = z.object({ contentHash: contentHashSchema });
