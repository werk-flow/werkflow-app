'use client';

import { useState } from 'react';

import type { useListNavigation } from '@/hooks/use-list-navigation';
import type { InventoryOverview } from '@/lib/inventory/types';

export type InventoryFilters = {
  search: string;
  typeFilter: string;
  stockFilter: string;
  locationFilter: string;
  changeSearch: (value: string) => void;
  changeType: (value: string) => void;
  changeStock: (value: string) => void;
  changeLocation: (value: string) => void;
};

/**
 * The filter inputs of the inventory list. The URL query owns the server page;
 * the inputs answer at once and take the query's values again when a
 * navigation from elsewhere has settled.
 */
export function useInventoryFilters(
  query: InventoryOverview['page']['query'],
  navigation: ReturnType<typeof useListNavigation>,
): InventoryFilters {
  const [search, setSearch] = useState(query.search);
  const [typeFilter, setTypeFilter] = useState<string>(query.type);
  const [stockFilter, setStockFilter] = useState<string>(query.stock);
  const [locationFilter, setLocationFilter] = useState<string>(query.location);
  const filterKey = JSON.stringify([query.search, query.type, query.stock, query.location]);
  const [appliedFilterKey, setAppliedFilterKey] = useState(filterKey);
  if (appliedFilterKey !== filterKey && !navigation.busy) {
    setAppliedFilterKey(filterKey);
    setSearch(query.search);
    setTypeFilter(query.type);
    setStockFilter(query.stock);
    setLocationFilter(query.location);
  }

  return {
    search,
    typeFilter,
    stockFilter,
    locationFilter,
    changeSearch: (value) => {
      setSearch(value);
      navigation.navigate({ search: value, page: 1 }, 200);
    },
    changeType: (value) => {
      setTypeFilter(value);
      navigation.navigate({ type: value, page: 1 });
    },
    changeStock: (value) => {
      setStockFilter(value);
      navigation.navigate({ stock: value, page: 1 });
    },
    changeLocation: (value) => {
      setLocationFilter(value);
      navigation.navigate({ location: value, page: 1 });
    },
  };
}
