import { z } from '@/lib/zod';
import { boundedText } from '@/lib/validation/text';
import { uuidSchema } from '@/lib/validation/uuid';
import { PRICE_QUANTITIES } from './article-price-terms';
import { INVENTORY_UNITS, type InventoryUnitCode } from './units';

// The boundary of the wholesaler import and the supplier catalog: action
// inputs, the database's answers, and the shapes the dialog and the picker
// read. The browser reads a delivery's files; only its parsed lines pass an
// action, in parts, never a file's bytes (decision 0001).

/** Files one delivery may hold, and the size of each the browser reads. */
export const WHOLESALER_IMPORT_MAX_FILES = 10;
export const WHOLESALER_IMPORT_MAX_FILE_BYTES = 250 * 1024 * 1024;
/** The staged lines one call carries at most. */
export const WHOLESALER_STAGE_MAX_LINES = 2000;
/** A catalog search needs this many characters, so its index can narrow it. */
export const SUPPLIER_CATALOG_SEARCH_MIN_LENGTH = 3;
/** The catalog rows one search shows; more matches are reported, never cut silently. */
export const SUPPLIER_CATALOG_SEARCH_LIMIT = 20;

const unitCodeSchema = z.literal(INVENTORY_UNITS.map((unit) => unit.code));
const fileNameSchema = boundedText(200);
const count = z.number().int().nonnegative();
/** A short field of a delivery line: a number, a group, an EAN, a code. */
const deliveryField = boundedText(200).nullable();

const discountSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('rebate_group'), rebateGroup: boundedText(200) }),
  z.object({ kind: z.literal('percent'), hundredthsOfPercent: z.number().int() }),
  z.object({ kind: z.literal('unread'), code: boundedText(50), value: boundedText(200) }),
]);

/** The delivery's own facts the batch keeps: header, rebate groups and the kinds of lines left out. */
export const openWholesalerImportInputSchema = z.object({
  supplierId: uuidSchema,
  fileNames: z.array(fileNameSchema).min(1).max(WHOLESALER_IMPORT_MAX_FILES),
  /** The SHA-256 of the delivery, computed in the browser, for the repeat warning. */
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  header: z
    .object({
      formatVersion: boundedText(50),
      supplierText: boundedText(500),
      date: z.iso.date().nullable(),
      currency: boundedText(20),
    })
    .nullable(),
  rebateGroups: z
    .array(z.object({ rebateGroup: boundedText(200), discount: discountSchema, text: boundedText(500) }))
    .max(5000),
  skipped: z.array(z.object({ kind: boundedText(50), lines: count })).max(100),
});
export type OpenWholesalerImportInput = z.infer<typeof openWholesalerImportInputSchema>;

/** One staged line, in the database's column names, as `stage_supplier_catalog_import_lines` takes it. */
const stagedImportLineSchema = z.object({
  ordinal: count,
  kind: z.enum(['article', 'price', 'deletion', 'rejection']),
  file_name: fileNameSchema,
  line_number: count,
  article_number: deliveryField,
  name: boundedText(500).nullable(),
  name_addition: boundedText(500).nullable(),
  unit_text: deliveryField,
  price_quantity: z.literal(PRICE_QUANTITIES).nullable(),
  price_kind: z.enum(['list', 'net']).nullable(),
  price_cents: z.number().int().min(0).max(2_147_483_647).nullable(),
  rebate_group: deliveryField,
  main_product_group: deliveryField,
  product_group: deliveryField,
  ean: deliveryField,
  matchcode: deliveryField,
  reason_code: boundedText(100).nullable(),
  reason: boundedText(1000).nullable(),
});
export type StagedImportLine = z.infer<typeof stagedImportLineSchema>;

export const stageWholesalerImportLinesInputSchema = z.object({
  importId: uuidSchema,
  lines: z.array(stagedImportLineSchema).min(1).max(WHOLESALER_STAGE_MAX_LINES),
});
export type StageWholesalerImportLinesInput = z.infer<typeof stageWholesalerImportLinesInputSchema>;

export const confirmWholesalerImportInputSchema = z.object({
  importId: uuidSchema,
  unitMapping: z.record(boundedText(200), unitCodeSchema.nullable()),
});
export type ConfirmWholesalerImportInput = z.infer<typeof confirmWholesalerImportInputSchema>;

export const wholesalerImportIdInputSchema = z.object({ importId: uuidSchema });
export type WholesalerImportIdInput = z.infer<typeof wholesalerImportIdInputSchema>;

export const wholesalerReportPartInputSchema = z.object({
  importId: uuidSchema,
  from: z.number().int().nonnegative(),
});
export type WholesalerReportPartInput = z.infer<typeof wholesalerReportPartInputSchema>;

export const supplierCatalogSearchInputSchema = z.object({ search: boundedText(200) });

export const adoptSupplierCatalogArticleInputSchema = z.object({ catalogArticleId: uuidSchema });
export type AdoptSupplierCatalogArticleInput = z.infer<typeof adoptSupplierCatalogArticleInputSchema>;

/** One unit text of a delivery: its articles and what they would do to the catalog. */
const unitEffectSchema = z
  .object({
    unit_text: z.string(),
    articles: count,
    new: count,
    changed: count,
    unchanged: count,
    unchanged_by_unit: z.record(z.string(), count),
    price_changed: count,
  })
  .transform((unit) => ({
    unitText: unit.unit_text,
    articles: unit.articles,
    created: unit.new,
    changed: unit.changed,
    unchanged: unit.unchanged,
    /** The otherwise unchanged articles per unit the catalog stores; another unit changes them. */
    unchangedByUnit: unit.unchanged_by_unit,
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
    supplier_name: z.string(),
  })
  .transform(
    (row): SupplierCatalogOption => ({
      id: row.id,
      supplierName: row.supplier_name,
      articleNumber: row.article_number,
      name: row.name,
      nameAddition: row.name_addition,
      unit: row.unit,
      priceKind: row.price_kind,
      priceCents: row.price_cents,
      priceQuantity: row.price_quantity,
    }),
  );
