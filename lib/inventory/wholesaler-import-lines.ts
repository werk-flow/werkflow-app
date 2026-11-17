import { buildCsv } from '@/lib/format/csv-zip';
import { formatDecimalDe, parseBoundedDecimalInput } from '@/lib/ui/decimal';
import type { InventoryUnitCode } from './units';
import {
  REBATE_BASIS_POINTS_MAX,
  type WholesalerImportPreview,
  type WholesalerImportResult,
  type WholesalerPriceChange,
} from './wholesaler-import-schemas';

// The wholesaler import's rules the dialog shares: the counts and the own
// articles' price changes a preview shows for the office's unit choice, the
// rebate the office types, and the report of rejected lines. No reader
// type enters here, so the browser bundle never reaches the reader seam;
// ./wholesaler-import-staging holds the server's staging rules.

/** A rejected line of a confirmed import, as its report lists it. */
export type WholesalerReportLine = {
  fileName: string;
  lineNumber: number;
  articleNumber: string | null;
  reason: string;
};

/** The report of the lines an import did not take, as a CSV the office opens in a spreadsheet. */
export function wholesalerImportReportCsv(lines: readonly WholesalerReportLine[]): Uint8Array {
  return buildCsv(
    ['Datei', 'Zeile', 'Artikelnummer', 'Grund'],
    lines.map((line) => [line.fileName, line.lineNumber, line.articleNumber ?? '', line.reason]),
  );
}

/**
 * The own articles' price changes that apply with the office's unit choice,
 * and those that do not because the delivery's unit is not the article's.
 * An article line's unit is the mapping of its unit text, and its article is
 * rejected without one; a price line keeps the catalog's unit. This is the
 * confirm's rule in confirm_supplier_catalog_import.
 */
export function ownPriceChangesForUnits(
  changes: readonly WholesalerPriceChange[],
  mapping: Readonly<Record<string, InventoryUnitCode | null>>,
): { applied: WholesalerPriceChange[]; otherUnit: WholesalerPriceChange[] } {
  const applied: WholesalerPriceChange[] = [];
  const otherUnit: WholesalerPriceChange[] = [];
  for (const change of changes) {
    const unit = change.unitText === null ? change.catalogUnit : (mapping[change.unitText] ?? null);
    if (unit === change.itemUnit) applied.push(change);
    else if (unit !== null) otherUnit.push(change);
  }
  return { applied, otherUnit };
}

/**
 * A rebate as the office types it, „32,5“ for 32,50 %, in hundredths of a
 * percent: null when blank, undefined when it is no percentage from 0 to 100
 * with at most two decimals.
 */
export function parseRebatePercent(value: string): number | null | undefined {
  // A percent sign only at the end: „10%0“ is no percentage.
  const percent = parseBoundedDecimalInput(value.trim().replace(/\s*%$/, ''), 2);
  if (percent === null || percent === undefined) return percent;
  const basisPoints = Math.round(percent * 100);
  return basisPoints <= REBATE_BASIS_POINTS_MAX ? basisPoints : undefined;
}

/** Hundredths of a percent as the office types them: 3250 is „32,5“. */
export function formatRebatePercent(basisPoints: number): string {
  return formatDecimalDe(basisPoints / 100);
}

/**
 * The counts a preview shows for the office's current unit choice: an
 * unmapped unit's articles count as rejected, and an otherwise unchanged
 * article mapped to another unit than the catalog stores counts as changed.
 */
export function wholesalerPreviewTotals(
  preview: Pick<
    WholesalerImportPreview,
    'units' | 'priceUpdates' | 'priceUnmatched' | 'removed' | 'rejected' | 'prices'
  >,
  mapping: Readonly<Record<string, InventoryUnitCode | null>>,
): WholesalerImportResult {
  const totals = { created: 0, changed: 0, unchanged: 0, priceChanged: 0, unitRejected: 0 };
  for (const unit of preview.units) {
    const mapped = mapping[unit.unitText];
    if (!mapped) {
      totals.unitRejected += unit.articles;
      continue;
    }
    const stillUnchanged = unit.unchangedByUnit[mapped] ?? 0;
    totals.created += unit.created;
    totals.changed += unit.changed + unit.unchanged - stillUnchanged;
    totals.unchanged += stillUnchanged;
    totals.priceChanged += unit.priceChanged;
  }
  return {
    ...totals,
    priceUpdates: preview.priceUpdates,
    priceUnmatched: preview.priceUnmatched,
    removed: preview.removed,
    rejected: preview.rejected,
    ownPricesChanged: ownPriceChangesForUnits(preview.prices.changes, mapping).applied.length,
  };
}
