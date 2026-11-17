import { buildCsv } from '@/lib/format/csv-zip';
import type { InventoryUnitCode } from './units';
import type { WholesalerImportPreview, WholesalerImportResult } from './wholesaler-import-schemas';

// The wholesaler import's rules the dialog shares: the counts a preview shows
// for the office's unit choice, and the report of rejected lines. No reader
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
 * The counts a preview shows for the office's current unit choice: an
 * unmapped unit's articles count as rejected, and an otherwise unchanged
 * article mapped to another unit than the catalog stores counts as changed.
 */
export function wholesalerPreviewTotals(
  preview: Pick<
    WholesalerImportPreview,
    'units' | 'priceUpdates' | 'priceUnmatched' | 'removed' | 'rejected'
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
  };
}
