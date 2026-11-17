'use client';

import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ListRow } from '@/components/ui/list-row';
import { formatPriceChange } from '@/lib/inventory/article-terms-format';
import type { InventoryUnitCode } from '@/lib/inventory/units';
import { formatRebatePercent, ownPriceChangesForUnits } from '@/lib/inventory/wholesaler-import-lines';
import type {
  WholesalerPriceChange,
  WholesalerPricePreview,
} from '@/lib/inventory/wholesaler-import-schemas';
import { formatGermanDate } from '@/lib/utils';
import { RevealedImportRows } from './inventory-import-outcomes';
import { rebateFieldId } from './use-wholesaler-import';

// The wholesaler preview's own-article part (werk-flow/werkflow-planning#477):
// the office's rebate per rebate group, and each own article's price the
// delivery changes, with the old and the new price per price quantity.

function rebateDescription(group: WholesalerPricePreview['rebateGroups'][number]): string {
  if (group.officeBasisPoints !== null)
    return `Gespeichert: ${formatRebatePercent(group.officeBasisPoints)} %`;
  if (group.deliveryBasisPoints !== null) {
    return `Vorschlag laut Lieferung: ${formatRebatePercent(group.deliveryBasisPoints)} %`;
  }
  return 'Ohne Rabatt bekommt ein Artikel mit Listenpreis keinen Einkaufspreis.';
}

/** The office's rebate per rebate group of the delivered own articles; leaving a field prices them again. */
function RebateFields({
  prices,
  texts,
  errors,
  disabled,
  onChange,
  onCommit,
}: {
  prices: WholesalerPricePreview;
  texts: Readonly<Record<string, string>>;
  errors: Readonly<Record<string, string | undefined>>;
  disabled: boolean;
  onChange: (rebateGroup: string, text: string) => void;
  onCommit: () => void;
}) {
  return (
    <div className="grid items-start gap-3 sm:grid-cols-2">
      {prices.rebateGroups.map((group, index) => (
        <Field
          key={group.rebateGroup}
          label={`Rabatt in % für „${group.rebateGroup}“${group.text ? ` · ${group.text}` : ''}`}
          htmlFor={rebateFieldId(index)}
          description={rebateDescription(group)}
          error={errors[rebateFieldId(index)]}
        >
          <Input
            inputMode="decimal"
            autoComplete="off"
            value={texts[group.rebateGroup] ?? ''}
            onChange={(event) => onChange(group.rebateGroup, event.target.value)}
            onBlur={onCommit}
            // The confirm sends the rebates it started with.
            disabled={disabled}
          />
        </Field>
      ))}
    </div>
  );
}

/** „Einkaufspreis: 4,00 € je m → 457,50 € je 100 m (Listenpreis minus 25 %)“. */
function changeText(change: WholesalerPriceChange): string {
  const rebate =
    change.rebateBasisPoints === null
      ? ''
      : ` (Listenpreis minus ${formatRebatePercent(change.rebateBasisPoints)} %)`;
  return `${formatPriceChange(change.kind, change.old, change.new, change.itemUnit)}${rebate}`;
}

/** The rebates and the own articles' price changes of a wholesaler preview, for the office's unit choice. */
export function WholesalerPriceChanges({
  prices,
  unitMapping,
  rebateTexts,
  rebateErrors,
  disabled,
  onRebateChange,
  onRebateCommit,
}: {
  prices: WholesalerPricePreview;
  unitMapping: Readonly<Record<string, InventoryUnitCode | null>>;
  rebateTexts: Readonly<Record<string, string>>;
  rebateErrors: Readonly<Record<string, string | undefined>>;
  disabled: boolean;
  onRebateChange: (rebateGroup: string, text: string) => void;
  onRebateCommit: () => void;
}) {
  const { applied, otherUnit } = ownPriceChangesForUnits(prices.changes, unitMapping);
  const [first] = applied;
  return (
    <section aria-label="Preise eigener Artikel" className="space-y-3">
      <div className="space-y-1">
        <p className="text-sm font-medium">Preise eigener Artikel</p>
        <p className="text-sm text-muted-foreground">
          Eigene Artikel, deren bevorzugter Lieferant dieser Großhändler ist, bekommen die Preise der
          Lieferung als neue Preise
          {first ? ` ab ${formatGermanDate(first.validFrom)}` : ''}. Frühere Preise bleiben erhalten.
        </p>
      </div>
      {prices.rebateGroups.length > 0 && (
        <RebateFields
          prices={prices}
          texts={rebateTexts}
          errors={rebateErrors}
          disabled={disabled}
          onChange={onRebateChange}
          onCommit={onRebateCommit}
        />
      )}
      {applied.length === 0 ? (
        <EmptyState size="compact" title="Kein Preis eines eigenen Artikels ändert sich." />
      ) : (
        <RevealedImportRows
          rows={applied}
          rowKey={(change) => `${change.itemId}:${change.kind}`}
          renderRow={(change) => (
            <ListRow variant="plain" rowId={`wholesaler-price-${change.itemId}-${change.kind}`}>
              <p className="truncate text-sm font-medium">{change.itemName}</p>
              <p className="text-xs text-muted-foreground">Nr. {change.articleNumber}</p>
              <p className="text-sm">{changeText(change)}</p>
            </ListRow>
          )}
        />
      )}
      {otherUnit.length > 0 && (
        <p className="text-sm text-warning-text">
          {otherUnit.length === 1
            ? '1 Preis wird nicht übernommen, weil die Einheit der Lieferung nicht die Einheit des Artikels ist.'
            : `${otherUnit.length} Preise werden nicht übernommen, weil die Einheit der Lieferung nicht die Einheit des Artikels ist.`}
        </p>
      )}
    </section>
  );
}
