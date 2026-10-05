'use client';

import { SearchInput } from '@/components/ui/search-input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { InventoryLocation } from '@/lib/inventory/types';
import { INVENTORY_ITEM_TYPE_LABELS, INVENTORY_STOCK_STATUS_LABELS } from '@/lib/inventory/types';
import type { InventoryFilters } from './use-inventory-filters';

const ALL_VALUE = 'all';

export function InventoryFilterBar({
  filters,
  locations,
}: {
  filters: InventoryFilters;
  locations: InventoryLocation[];
}) {
  return (
    <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
      <SearchInput
        wrapperClassName="min-w-0 md:w-64"
        value={filters.search}
        onValueChange={filters.changeSearch}
        placeholder="Suchen"
        aria-label="Artikel suchen"
      />
      <Select value={filters.typeFilter} onValueChange={filters.changeType}>
        <SelectTrigger className="md:w-44" aria-label="Nach Typ filtern">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_VALUE}>Alle Typen</SelectItem>
          {Object.entries(INVENTORY_ITEM_TYPE_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={filters.stockFilter} onValueChange={filters.changeStock}>
        <SelectTrigger className="md:w-40" aria-label="Nach Bestand filtern">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_VALUE}>Alle Bestände</SelectItem>
          {Object.entries(INVENTORY_STOCK_STATUS_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="md:w-44">
        <SearchableSelect
          ariaLabel="Nach Lager filtern"
          options={[
            { value: ALL_VALUE, label: 'Alle Lager' },
            ...locations.map((location) => ({
              value: location.id,
              label: location.name,
            })),
          ]}
          value={filters.locationFilter}
          onChange={filters.changeLocation}
          searchPlaceholder="Lager suchen …"
          emptyMessage="Kein Lager gefunden"
        />
      </div>
    </div>
  );
}
