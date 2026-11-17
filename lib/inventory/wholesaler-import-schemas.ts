import { z } from '@/lib/zod';
import { boundedText } from '@/lib/validation/text';
import { uuidSchema } from '@/lib/validation/uuid';
import { ARTICLE_PRICE_KINDS, PRICE_QUANTITIES } from './article-price-terms';
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
/**
 * The lines one delivery stages at most. A line's ordinal stays below it and
 * is unique in its batch, so no number of parts grows a batch past it.
 */
export const WHOLESALER_IMPORT_MAX_LINES = 2_000_000;
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
const stagedImportLineSchema = z
  .object({
    ordinal: count.max(WHOLESALER_IMPORT_MAX_LINES - 1),
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
  })
  // The catalog keeps a price kind only with its amount; a lone half would fail the confirm.
  .refine((line) => (line.price_kind === null) === (line.price_cents === null))
  // The staging's check reads a missing quantity as passed; the catalog needs one for every article.
  .refine((line) => line.kind !== 'article' || line.price_quantity !== null);
export type StagedImportLine = z.infer<typeof stagedImportLineSchema>;

export const stageWholesalerImportLinesInputSchema = z.object({
  importId: uuidSchema,
  lines: z.array(stagedImportLineSchema).min(1).max(WHOLESALER_STAGE_MAX_LINES),
});
export type StageWholesalerImportLinesInput = z.infer<typeof stageWholesalerImportLinesInputSchema>;

/** Hundredths of a percent: 3250 is 32,50 %. */
export const REBATE_BASIS_POINTS_MAX = 10_000;
/** The office's rebates of one delivery: rebate group to hundredths of a percent, or null for none. */
const rebatesSchema = z.record(
  z
    .string()
    .min(1)
    .max(200)
    .refine((group) => group === group.trim()),
  z.number().int().min(0).max(REBATE_BASIS_POINTS_MAX).nullable(),
);
export type WholesalerRebates = z.infer<typeof rebatesSchema>;

/** The fingerprint of the own articles' price changes a price preview answered. */
const priceFingerprintSchema = z.string().regex(/^[0-9a-f]{32}$/);

export const confirmWholesalerImportInputSchema = z.object({
  importId: uuidSchema,
  unitMapping: z.record(boundedText(200), unitCodeSchema.nullable()),
  rebates: rebatesSchema,
  /** The price preview the dialog shows; the confirm writes only its changes. */
  priceFingerprint: priceFingerprintSchema,
});
export type ConfirmWholesalerImportInput = z.infer<typeof confirmWholesalerImportInputSchema>;

/** The own articles' price changes for the office's rebates, or with null for the saved ones. */
export const previewWholesalerPricesInputSchema = z.object({
  importId: uuidSchema,
  rebates: rebatesSchema.nullable(),
});
export type PreviewWholesalerPricesInput = z.infer<typeof previewWholesalerPricesInputSchema>;

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
    // A batch confirmed before own prices changed stored no count.
    own_prices_changed: count.default(0),
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
    ownPricesChanged: answer.own_prices_changed,
    alreadyConfirmed: answer.already_confirmed,
  }));

const priceQuantitySchema = z.literal(PRICE_QUANTITIES);

/** One own article's price the delivery changes, as `preview_supplier_catalog_import_prices` answers it. */
const priceChangeSchema = z
  .object({
    item_id: uuidSchema,
    item_name: z.string(),
    item_unit: z.string(),
    article_number: z.string(),
    unit_text: z.string().nullable(),
    catalog_unit: z.string().nullable(),
    kind: z.enum(ARTICLE_PRICE_KINDS),
    rebate_group: z.string().nullable(),
    rebate_basis_points: count.nullable(),
    old_amount_cents: count.nullable(),
    old_price_quantity: priceQuantitySchema.nullable(),
    new_amount_cents: count,
    new_price_quantity: priceQuantitySchema,
    valid_from: z.iso.date(),
  })
  .transform((change) => ({
    itemId: change.item_id,
    itemName: change.item_name,
    itemUnit: change.item_unit,
    articleNumber: change.article_number,
    /** The delivery's unit text of an article line; the office's mapping decides its unit. */
    unitText: change.unit_text,
    /** The catalog's unit of a price line, which the delivery does not restate. */
    catalogUnit: change.catalog_unit,
    kind: change.kind,
    rebateGroup: change.rebate_group,
    rebateBasisPoints: change.rebate_basis_points,
    old:
      change.old_amount_cents !== null && change.old_price_quantity !== null
        ? { amountCents: change.old_amount_cents, priceQuantity: change.old_price_quantity }
        : null,
    new: { amountCents: change.new_amount_cents, priceQuantity: change.new_price_quantity },
    validFrom: change.valid_from,
  }));
export type WholesalerPriceChange = z.output<typeof priceChangeSchema>;

export const pricesAnswerSchema = z
  .object({
    rebate_groups: z.array(
      z.object({
        rebate_group: z.string(),
        text: z.string(),
        office_basis_points: count.nullable(),
        delivery_basis_points: count.nullable(),
      }),
    ),
    rebates: z.record(z.string(), count.nullable()),
    changes: z.array(priceChangeSchema),
    fingerprint: priceFingerprintSchema,
  })
  .transform((answer) => ({
    rebateGroups: answer.rebate_groups.map((group) => ({
      rebateGroup: group.rebate_group,
      text: group.text,
      officeBasisPoints: group.office_basis_points,
      deliveryBasisPoints: group.delivery_basis_points,
    })),
    rebates: answer.rebates,
    changes: answer.changes,
    fingerprint: answer.fingerprint,
  }));
/** The own articles' price changes of a preview, with the rebate groups and the rebates they were computed for. */
export type WholesalerPricePreview = z.output<typeof pricesAnswerSchema>;

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
  /** The own articles' prices the delivery changes, for the rebates in it. */
  prices: WholesalerPricePreview;
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
    price_quantity: priceQuantitySchema,
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
