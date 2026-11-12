'use client';

import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { Label } from '@/components/ui/label';
import { ListRow } from '@/components/ui/list-row';
import type { InventoryImportRow } from '@/lib/inventory/action-inputs';
import {
  importRowEffect,
  importRowProblem,
  type ImportRowOutcome,
  type ImportTotals,
  type InventoryImportMode,
} from '@/lib/inventory/csv-import';
import { formatInventoryQuantity } from '@/lib/inventory/types';

// A preview of a large file reveals its rows in steps, so the dialog stays responsive.
const ROWS_PER_STEP = 100;

function rowBadge(row: ImportRowOutcome): {
  label: string;
  variant: 'secondary' | 'outline' | 'warning' | 'destructive';
} {
  if (row.outcome === 'rejected') return { label: 'Abgelehnt', variant: 'destructive' };
  if (row.outcome === 'missing_location') return { label: 'Ohne Lager', variant: 'warning' };
  return row.matchedBy === null
    ? { label: 'Neu', variant: 'secondary' }
    : { label: 'Vorhanden', variant: 'outline' };
}

const MATCHED_BY_LABELS = { internal_sku: 'über Artikelnummer', barcode: 'über Barcode' } as const;

/** One row of the file and what the import does with it. */
function OutcomeRow({
  row,
  fileRow,
  lineNumber,
  mode,
}: {
  row: ImportRowOutcome;
  fileRow: InventoryImportRow | undefined;
  lineNumber: number;
  mode: InventoryImportMode;
}) {
  const badge = rowBadge(row);
  const problem = importRowProblem(row, fileRow?.unit ?? null);
  const effect = importRowEffect(row, mode);
  const name = row.itemName ?? (fileRow?.name.trim() || 'Ohne Artikelname');
  const matched = row.matchedBy === null ? '' : ` · vorhandener Artikel ${MATCHED_BY_LABELS[row.matchedBy]}`;
  return (
    <ListRow variant="plain" rowId={`import-row-${row.index}`} data-testid="inventory-import-row">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="text-xs text-muted-foreground">
            Zeile {lineNumber}
            {matched}
          </p>
          {effect && <p className="text-sm">{effect}</p>}
          {problem && <p className="text-sm text-destructive">{problem}</p>}
        </div>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>
    </ListRow>
  );
}

/** The counts above the rows: new, matched, rejected, and the stock each Lager receives. */
export function ImportTotalsSummary({ totals, mode }: { totals: ImportTotals; mode: InventoryImportMode }) {
  const counts = [
    { label: 'Neue Artikel', value: totals.created },
    { label: 'Vorhandene Artikel', value: totals.matched },
    { label: 'Abgelehnt', value: totals.rejected },
  ];
  return (
    <section aria-label="Summen" className="space-y-3 rounded-lg border p-3">
      <dl className="grid grid-cols-3 gap-3">
        {counts.map((count) => (
          <div key={count.label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{count.label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{count.value}</dd>
          </div>
        ))}
      </dl>
      <div className="space-y-1 text-sm">
        {mode === 'master_data' ? (
          <p>Nur Stammdaten und Preise: Es wird kein Bestand gebucht.</p>
        ) : totals.locations.length === 0 ? (
          <p className="text-muted-foreground">Es kommt kein Bestand dazu.</p>
        ) : (
          totals.locations.map((location) => (
            <p key={location.locationName}>
              <span className="font-medium">
                {location.locationName}
                {location.isNew ? ' (neues Lager)' : ''}:
              </span>{' '}
              {location.quantities
                .map((entry) => `+${formatInventoryQuantity(entry.quantity, entry.unit)}`)
                .join(', ')}
            </p>
          ))
        )}
        {totals.withoutLocation > 0 && (
          <p className="text-warning-text">
            {totals.withoutLocation} {totals.withoutLocation === 1 ? 'Zeile' : 'Zeilen'} ohne Lager: Artikel
            übernommen, kein Bestand gebucht.
          </p>
        )}
      </div>
    </section>
  );
}

/** Every row's effect, all rows or only those with a note, revealed in steps. */
export function ImportOutcomeList({
  outcomes,
  importRows,
  lineNumbers,
  mode,
  onlyProblems = false,
}: {
  outcomes: readonly ImportRowOutcome[];
  importRows: readonly InventoryImportRow[];
  lineNumbers: readonly number[];
  mode: InventoryImportMode;
  onlyProblems?: boolean;
}) {
  const [filter, setFilter] = useState<'all' | 'problems'>(onlyProblems ? 'problems' : 'all');
  const [visibleCount, setVisibleCount] = useState(ROWS_PER_STEP);
  const problemRows = outcomes.filter((row) => importRowProblem(row, null) !== null);
  const shown = filter === 'problems' ? problemRows : outcomes;
  return (
    <section aria-label="Zeilen" className="space-y-3">
      {!onlyProblems && (
        <div className="flex items-center gap-2">
          <Checkbox
            id="inventory-import-only-problems"
            checked={filter === 'problems'}
            onCheckedChange={(checked) => {
              setFilter(checked === true ? 'problems' : 'all');
              setVisibleCount(ROWS_PER_STEP);
            }}
          />
          <Label htmlFor="inventory-import-only-problems" className="font-normal">
            Nur Zeilen mit Hinweis zeigen ({problemRows.length} von {outcomes.length})
          </Label>
        </div>
      )}
      {shown.length === 0 ? (
        <EmptyState size="compact" title="Keine Zeile mit Hinweis gefunden" />
      ) : (
        <div className="divide-y rounded-lg border">
          {shown.slice(0, visibleCount).map((row) => (
            <OutcomeRow
              key={row.index}
              row={row}
              fileRow={importRows[row.index]}
              lineNumber={lineNumbers[row.index] ?? row.index + 2}
              mode={mode}
            />
          ))}
        </div>
      )}
      {shown.length > visibleCount && (
        <Button
          type="button"
          variant="outline"
          onClick={() => setVisibleCount((count) => count + ROWS_PER_STEP)}
        >
          Weitere {Math.min(ROWS_PER_STEP, shown.length - visibleCount)} Zeilen anzeigen
        </Button>
      )}
    </section>
  );
}
