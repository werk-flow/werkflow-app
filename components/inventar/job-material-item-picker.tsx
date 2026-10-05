'use client';

import { Plus } from 'lucide-react';

import { SearchInput } from '@/components/ui/search-input';
import { SectionError } from '@/components/ui/section-error';
import { PlainButton } from '@/components/ui/plain-button';
import type { InventoryPickerOption } from '@/lib/inventory/types';
import { formatInventoryQuantity, INVENTORY_PICKER_PAGE_SIZE } from '@/lib/inventory/types';
import type { MaterialDialogMode } from './job-material-dialog-model';

/** The left column of the material dialog: catalog search and the pickable items. */
export function MaterialItemPicker({
  mode,
  search,
  onSearchChange,
  filteredItems,
  hasMoreItems,
  isSearching,
  searchFailed,
  onRetrySearch,
  onAdd,
}: {
  mode: MaterialDialogMode;
  search: string;
  onSearchChange: (search: string) => void;
  /** The matching items of the loaded catalog page. */
  filteredItems: InventoryPickerOption[];
  hasMoreItems: boolean;
  isSearching: boolean;
  /** The server search for the current text failed; the retry asks again for the same text. */
  searchFailed: boolean;
  onRetrySearch: () => void;
  onAdd: (item: InventoryPickerOption) => void;
}) {
  return (
    <div className="space-y-3">
      <SearchInput
        value={search}
        onValueChange={onSearchChange}
        onKeyDown={(event) => {
          // Enter while searching must never book the movement.
          if (event.key === 'Enter') event.preventDefault();
        }}
        aria-label="Artikel suchen"
        placeholder="Artikel, SKU, Barcode, Lager, Lieferant suchen…"
      />
      {searchFailed && (
        <SectionError onRetry={onRetrySearch} retryPending={isSearching}>
          Die Artikelsuche ist fehlgeschlagen. Angezeigt werden nur die bereits geladenen Artikel.
        </SectionError>
      )}
      <div className="max-h-[420px] overflow-auto rounded-md border">
        {isSearching && filteredItems.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground" role="status">
            Material wird gesucht…
          </p>
        ) : filteredItems.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            Keine passenden Artikel gefunden.
          </p>
        ) : (
          <div className="divide-y">
            {filteredItems.map((item) => {
              const hasStockForTake =
                mode !== 'take' || item.stockByLocation.some((stock) => stock.quantityOnHand > 0);
              return (
                <PlainButton
                  key={item.id}
                  type="button"
                  className="flex w-full items-start justify-between gap-3 px-3 py-3 text-left hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => onAdd(item)}
                  disabled={!hasStockForTake}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{item.name}</span>
                    <span className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      {item.internalSku && <span>SKU {item.internalSku}</span>}
                      {item.primaryBarcode && <span>Barcode {item.primaryBarcode}</span>}
                      {item.categoryName && <span>{item.categoryName}</span>}
                      {item.supplierName && <span>{item.supplierName}</span>}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {item.stockByLocation.length > 0
                        ? item.stockByLocation
                            .map(
                              (stock) =>
                                `${stock.locationName}: ${formatInventoryQuantity(
                                  stock.quantityOnHand,
                                  item.unit,
                                )}`,
                            )
                            .join(' · ')
                        : 'Noch keinem Lager zugeordnet'}
                    </span>
                  </span>
                  <Plus className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                </PlainButton>
              );
            })}
          </div>
        )}
      </div>
      {hasMoreItems && (
        <p className="text-xs text-muted-foreground" role="status">
          Es werden höchstens {INVENTORY_PICKER_PAGE_SIZE} Artikel angezeigt. Suche nach Name, SKU, Hersteller
          oder Barcode, um weitere zu finden.
        </p>
      )}
    </div>
  );
}
