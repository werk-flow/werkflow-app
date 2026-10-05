'use client';

import { Loader2, Warehouse } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { isServerRow, withPendingDraft } from '@/lib/inventory/pending-drafts';
import {
  formatInventoryQuantity,
  INVENTORY_LOCATION_TYPE_LABELS,
  type InventoryLocation,
  type InventoryLocationType,
  type InventoryOverviewItem,
} from '@/lib/inventory/types';

export type PendingLocationDraft = {
  confirmedId: string | null;
  name: string;
  locationType: InventoryLocationType;
};

export function LocationsView({
  locations,
  items,
  itemCounts,
  pendingDraft,
}: {
  locations: InventoryLocation[];
  items: InventoryOverviewItem[];
  itemCounts: Record<string, number>;
  pendingDraft: PendingLocationDraft | null;
}) {
  const shownLocations = withPendingDraft(locations, pendingDraft);
  if (shownLocations.length === 0) {
    return (
      <EmptyState
        icon={Warehouse}
        title="Noch keine Lager"
        description="Lege das erste Lager an, um Bestand einem Ort zuzuordnen."
      />
    );
  }
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {shownLocations.map((location) => {
        if (!isServerRow(location)) {
          return (
            <div
              key="pending-location"
              role="status"
              aria-label="Lager wird angelegt"
              className="min-w-0 rounded-lg border bg-card p-4 opacity-70"
            >
              <div className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
                <Warehouse className="size-4 text-muted-foreground" />
                <h2 className="font-semibold">{location.name}</h2>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {INVENTORY_LOCATION_TYPE_LABELS[location.locationType]}
              </p>
            </div>
          );
        }
        const locationItems = items
          .filter((item) => item.stockByLocation.some((stock) => stock.locationId === location.id))
          .sort((left, right) => left.name.localeCompare(right.name, 'de'));
        const itemCount = itemCounts[location.id] ?? 0;
        // The server sends a six-item preview per location; the count is complete.
        const previewItems = locationItems.slice(0, 6);
        const furtherItemCount = itemCount - previewItems.length;
        return (
          <div
            key={location.id}
            className="min-w-0 rounded-lg border bg-card p-4"
            role="region"
            aria-labelledby={`inventory-location-${location.id}`}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Warehouse className="size-4 text-muted-foreground" />
                  <h2 id={`inventory-location-${location.id}`} className="font-semibold">
                    {location.name}
                  </h2>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {INVENTORY_LOCATION_TYPE_LABELS[location.locationType]}
                </p>
              </div>
              <Badge variant="secondary">{itemCount} Artikel</Badge>
            </div>
            <div className="mb-3 rounded-md bg-muted/40 px-3 py-2 text-sm">
              Artikel in diesem Lager:{' '}
              <span className="font-medium tabular-nums">{itemCount.toLocaleString('de-DE')}</span>
            </div>
            {itemCount === 0 ? (
              <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                Keine Artikel in diesem Lager.
              </p>
            ) : (
              <div className="divide-y rounded-md border">
                {previewItems.map((item) => {
                  const stock = item.stockByLocation.find((entry) => entry.locationId === location.id);
                  return (
                    <div key={item.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="min-w-0 truncate font-medium">{item.name}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {formatInventoryQuantity(stock?.quantityOnHand ?? 0, item.unit)}
                      </span>
                    </div>
                  );
                })}
                {furtherItemCount > 0 ? (
                  <p className="px-3 py-2 text-sm text-muted-foreground">
                    und {furtherItemCount.toLocaleString('de-DE')} weitere Artikel
                  </p>
                ) : null}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
