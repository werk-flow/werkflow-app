'use client';

import { useState } from 'react';

import type { useListNavigation } from '@/hooks/use-list-navigation';
import type { InventoryOverview } from '@/lib/inventory/types';

export type InventoryFilters = {
  search: string;
  typeFilter: string;
  stockFilter: string;
  locationFilter: string;
  /** The movement history's kind, person and Berlin date range (`YYYY-MM-DD`, empty for no bound). */
  kindFilter: string;
  personFilter: string;
  fromDate: string;
  toDate: string;
  changeSearch: (value: string) => void;
  changeType: (value: string) => void;
  changeStock: (value: string) => void;
  changeLocation: (value: string) => void;
  changeKind: (value: string) => void;
  changePerson: (value: string) => void;
  changeFromDate: (value: string) => void;
  changeToDate: (value: string) => void;
  /** Clears the history's search and filters at once. */
  resetHistoryFilters: () => void;
};

/**
 * The filter inputs of the inventory list and its movement history. The URL
 * query owns the server page; the inputs answer at once and take the query's
 * values again when a navigation from elsewhere has settled.
 */
export function useInventoryFilters(
  query: InventoryOverview['page']['query'],
  navigation: ReturnType<typeof useListNavigation>,
): InventoryFilters {
  const [search, setSearch] = useState(query.search);
  const [typeFilter, setTypeFilter] = useState<string>(query.type);
  const [stockFilter, setStockFilter] = useState<string>(query.stock);
  const [locationFilter, setLocationFilter] = useState<string>(query.location);
  const [kindFilter, setKindFilter] = useState<string>(query.kind);
  const [personFilter, setPersonFilter] = useState<string>(query.person);
  const [fromDate, setFromDate] = useState(query.from);
  const [toDate, setToDate] = useState(query.to);
  const filterKey = JSON.stringify([
    query.search,
    query.type,
    query.stock,
    query.location,
    query.kind,
    query.person,
    query.from,
    query.to,
  ]);
  const [appliedFilterKey, setAppliedFilterKey] = useState(filterKey);
  if (appliedFilterKey !== filterKey && !navigation.busy) {
    setAppliedFilterKey(filterKey);
    setSearch(query.search);
    setTypeFilter(query.type);
    setStockFilter(query.stock);
    setLocationFilter(query.location);
    setKindFilter(query.kind);
    setPersonFilter(query.person);
    setFromDate(query.from);
    setToDate(query.to);
  }

  return {
    search,
    typeFilter,
    stockFilter,
    locationFilter,
    kindFilter,
    personFilter,
    fromDate,
    toDate,
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
    changeKind: (value) => {
      setKindFilter(value);
      navigation.navigate({ kind: value, page: 1 });
    },
    changePerson: (value) => {
      setPersonFilter(value);
      navigation.navigate({ person: value, page: 1 });
    },
    changeFromDate: (value) => {
      setFromDate(value);
      navigation.navigate({ from: value, page: 1 });
    },
    changeToDate: (value) => {
      setToDate(value);
      navigation.navigate({ to: value, page: 1 });
    },
    resetHistoryFilters: () => {
      setSearch('');
      setLocationFilter('all');
      setKindFilter('all');
      setPersonFilter('all');
      setFromDate('');
      setToDate('');
      navigation.navigate({ search: null, location: null, kind: null, person: null, from: null, to: null, page: 1 });
    },
  };
}
