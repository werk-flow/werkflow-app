import { z } from '@/lib/zod';
import { boundedText } from '@/lib/validation/text';
import { uuidSchema } from '@/lib/validation/uuid';
import { PRICE_QUANTITIES } from './article-price-terms';
import { INVENTORY_UNITS, type InventoryUnitCode } from './units';

// The boundary of the wholesaler import and the supplier catalog: action
// inputs, the database's answers, and the shapes the dialog and the picker
// read. A delivery's bytes never pass an action: the browser uploads them
// through a signed URL (docs/technical/document-storage-and-access.md).

/** Files one delivery may hold, and the size of each. */
export const WHOLESALER_IMPORT_MAX_FILES = 10;
export const WHOLESALER_IMPORT_MAX_FILE_BYTES = 250 * 1024 * 1024;
/** The one content type an upload of a delivery file is signed and sent with: the files are plain bytes. */
export const WHOLESALER_FILE_CONTENT_TYPE = 'application/octet-stream';
/** A catalog search needs this many characters, so its index can narrow it. */
export const SUPPLIER_CATALOG_SEARCH_MIN_LENGTH = 3;
export const SUPPLIER_CATALOG_SEARCH_LIMIT = 20;

const unitCodeSchema = z.literal(INVENTORY_UNITS.map((unit) => unit.code));
const fileNameSchema = boundedText(200);

export const wholesalerUploadTicketInputSchema = z.object({
  supplierId: uuidSchema,
  files: z
    .array(z.object({ name: fileNameSchema, sizeBytes: z.number().int() }))
    .min(1)
    .max(WHOLESALER_IMPORT_MAX_FILES),
});
export type WholesalerUploadTicketInput = z.infer<typeof wholesalerUploadTicketInputSchema>;

export const previewWholesalerImportInputSchema = z.object({
  uploadId: uuidSchema,
  supplierId: uuidSchema,
  fileNames: z.array(fileNameSchema).min(1).max(WHOLESALER_IMPORT_MAX_FILES),
});
export type PreviewWholesalerImportInput = z.infer<typeof previewWholesalerImportInputSchema>;

export const confirmWholesalerImportInputSchema = z.object({
  importId: uuidSchema,
  unitMapping: z.record(boundedText(200), unitCodeSchema.nullable()),
});
export type ConfirmWholesalerImportInput = z.infer<typeof confirmWholesalerImportInputSchema>;

export const wholesalerImportIdInputSchema = z.object({ importId: uuidSchema });
export type WholesalerImportIdInput = z.infer<typeof wholesalerImportIdInputSchema>;

export const supplierCatalogSearchInputSchema = z.object({ search: boundedText(200) });

export const adoptSupplierCatalogArticleInputSchema = z.object({ catalogArticleId: uuidSchema });
export type AdoptSupplierCatalogArticleInput = z.infer<typeof adoptSupplierCatalogArticleInputSchema>;

const count = z.number().int().nonnegative();

/** One unit text of a delivery: its articles and what they would do to the catalog. */
const unitEffectSchema = z
  .object({
    unit_text: z.string(),
    articles: count,
    new: count,
    changed: count,
    unchanged: count,
    price_changed: count,
  })
  .transform((unit) => ({
    unitText: unit.unit_text,
    articles: unit.articles,
    created: unit.new,
    changed: unit.changed,
    unchanged: unit.unchanged,
    priceChanged: unit.price_changed,
  }));

export const previewAnswerSchema = z
  .object({
    units: z.array(unitEffectSchema),
    price_updates: count,
    price_unmatched: count,
    removed: count,
    rejected: count,
    repeat: z.object({ confirmed_at: z.string(), confirmed_by: uuidSchema.nullable() }).nullable(),
  })
  .transform((answer) => ({
    units: answer.units,
    priceUpdates: answer.price_updates,
    priceUnmatched: answer.price_unmatched,
    removed: answer.removed,
    rejected: answer.rejected,
    repeat: answer.repeat,
  }));

export const confirmAnswerSchema = z
  .object({
    new: count,
    changed: count,
    unchanged: count,
    price_changed: count,
    unit_rejected: count,
    price_updates: count,
    price_unmatched: count,
    removed: count,
    rejected: count,
    already_confirmed: z.boolean(),
  })
  .transform((answer) => ({
    created: answer.new,
    changed: answer.changed,
    unchanged: answer.unchanged,
    priceChanged: answer.price_changed,
    unitRejected: answer.unit_rejected,
    priceUpdates: answer.price_updates,
    priceUnmatched: answer.price_unmatched,
    removed: answer.removed,
    rejected: answer.rejected,
    alreadyConfirmed: answer.already_confirmed,
  }));

type WholesalerUnitEffect = z.output<typeof unitEffectSchema>;
/** The preview's counts as the database answers them, without the earlier import. */
export type WholesalerPreviewEffects = Omit<z.output<typeof previewAnswerSchema>, 'repeat'>;
export type WholesalerImportResult = Omit<z.output<typeof confirmAnswerSchema>, 'alreadyConfirmed'>;

/** What the dialog shows before a confirm: the delivery, each unit text's effect, and an earlier import of the same delivery. */
export type WholesalerImportPreview = {
  importId: string;
  delivery: {
    formatVersion: string | null;
    supplierText: string | null;
    date: string | null;
    fileNames: string[];
  };
  units: WholesalerUnitEffect[];
  /** The unit each unit text names by itself, or null where the office must choose. */
  suggestedUnits: Record<string, InventoryUnitCode | null>;
  priceUpdates: number;
  priceUnmatched: number;
  removed: number;
  rejected: number;
  /** The lines the reader or the import refused, with file, line and reason. */
  rejections: { fileName: string; lineNumber: number; articleNumber: string | null; reason: string }[];
  rebateGroups: number;
  repeat: { confirmedAt: string; confirmedBy: string } | null;
};

export const adoptAnswerSchema = z
  .object({ item_id: uuidSchema, created: z.boolean() })
  .transform((answer) => ({ itemId: answer.item_id, created: answer.created }));

/** One catalog row as the picker offers it to Admin and Büro. */
export type SupplierCatalogOption = {
  id: string;
  supplierName: string;
  articleNumber: string;
  name: string;
  nameAddition: string;
  unit: InventoryUnitCode;
  priceKind: 'list' | 'net' | null;
  priceCents: number | null;
  priceQuantity: (typeof PRICE_QUANTITIES)[number];
};

export const catalogRowSchema = z
  .object({
    id: uuidSchema,
    article_number: z.string(),
    name: z.string(),
    name_addition: z.string(),
    unit: unitCodeSchema,
    price_kind: z.enum(['list', 'net']).nullable(),
    price_cents: z.number().int().nullable(),
    price_quantity: z.literal(PRICE_QUANTITIES),
    inventory_suppliers: z.object({ name: z.string() }),
  })
  .transform(
    (row): SupplierCatalogOption => ({
      id: row.id,
      supplierName: row.inventory_suppliers.name,
      articleNumber: row.article_number,
      name: row.name,
      nameAddition: row.name_addition,
      unit: row.unit,
      priceKind: row.price_kind,
      priceCents: row.price_cents,
      priceQuantity: row.price_quantity,
    }),
  );
