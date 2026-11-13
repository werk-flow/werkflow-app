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

type Query = InventoryOverview['page']['query'];
const FILTER_KEYS = ['search', 'type', 'stock', 'location', 'kind', 'person', 'from', 'to'] as const;
type FilterKey = (typeof FILTER_KEYS)[number];
type FilterValues = Record<FilterKey, string>;

/** The URL value of each filter, an empty search and date bound included. */
function filterValues(query: Query): FilterValues {
  return {
    search: query.search,
    type: query.type,
    stock: query.stock,
    location: query.location,
    kind: query.kind,
    person: query.person,
    from: query.from,
    to: query.to,
  };
}

/** The history's filters at their defaults; the item views' type and stock stay. */
const HISTORY_RESET = { search: '', location: 'all', kind: 'all', person: 'all', from: '', to: '' } as const;

/**
 * The filter inputs of the inventory list and its movement history. The URL
 * query owns the server page; the inputs answer at once and take the query's
 * values again when a navigation from elsewhere has settled.
 */
export function useInventoryFilters(
  query: Query,
  navigation: ReturnType<typeof useListNavigation>,
): InventoryFilters {
  const [values, setValues] = useState(() => filterValues(query));
  const filterKey = JSON.stringify(filterValues(query));
  const [appliedFilterKey, setAppliedFilterKey] = useState(filterKey);
  if (appliedFilterKey !== filterKey && !navigation.busy) {
    setAppliedFilterKey(filterKey);
    setValues(filterValues(query));
  }

  const change =
    (key: FilterKey, delay = 0) =>
    (value: string): void => {
      setValues((previous) => ({ ...previous, [key]: value }));
      navigation.navigate({ [key]: value, page: 1 }, delay);
    };

  return {
    search: values.search,
    typeFilter: values.type,
    stockFilter: values.stock,
    locationFilter: values.location,
    kindFilter: values.kind,
    personFilter: values.person,
    fromDate: values.from,
    toDate: values.to,
    changeSearch: change('search', 200),
    changeType: change('type'),
    changeStock: change('stock'),
    changeLocation: change('location'),
    changeKind: change('kind'),
    changePerson: change('person'),
    changeFromDate: change('from'),
    changeToDate: change('to'),
    resetHistoryFilters: () => {
      setValues((previous) => ({ ...previous, ...HISTORY_RESET }));
      navigation.navigate({ ...HISTORY_RESET, page: 1 });
    },
  };
}
