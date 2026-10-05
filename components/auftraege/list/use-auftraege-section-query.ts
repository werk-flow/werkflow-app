'use client';

import { useCallback, useState } from 'react';

import type { useListNavigation } from '@/hooks/use-list-navigation';
import type { JobListPagination, JobListSection } from '@/lib/jobs/list-page';
import { EMPTY_FILTER_STATE, type FilterState, type SortColumn } from '@/lib/jobs/types';

type AuftraegeSectionQueryOptions = {
  section: JobListSection;
  /** Server-paged lists keep search, filters and sort in the URL; the local state bridges a pending navigation. */
  pagination: JobListPagination | undefined;
  navigation: ReturnType<typeof useListNavigation>;
  /** The direction a newly chosen sort column starts with. */
  firstSortDirection: 'asc' | 'desc';
};

export type AuftraegeSectionQuery = ReturnType<typeof useAuftraegeSectionQuery>;

/** Search, dropdown filters and sort of one list section (active, parked or archived). */
export function useAuftraegeSectionQuery({
  section,
  pagination,
  navigation,
  firstSortDirection,
}: AuftraegeSectionQueryOptions) {
  const query = pagination?.queries[section];
  const [searchState, setSearch] = useState(query?.search ?? '');
  const [filtersState, setFilters] = useState<FilterState>(
    query
      ? {
          clientIds: query.clientIds,
          employeeIds: query.employeeIds,
          dateFrom: query.dateFrom,
          dateTo: query.dateTo,
          entryType: query.entryType,
        }
      : EMPTY_FILTER_STATE,
  );
  const [sortColumnState, setSortColumn] = useState<SortColumn>(query?.sort ?? 'datum');
  const [sortDirectionState, setSortDirection] = useState<'asc' | 'desc'>(query?.direction ?? 'desc');

  // The URL is the authority once its navigation has settled.
  const settledQuery = query && !navigation.busy ? query : undefined;
  const search = settledQuery ? settledQuery.search : searchState;
  const sortColumn = settledQuery ? settledQuery.sort : sortColumnState;
  const sortDirection = settledQuery ? settledQuery.direction : sortDirectionState;
  const filters = settledQuery
    ? {
        clientIds: settledQuery.clientIds,
        employeeIds: settledQuery.employeeIds,
        dateFrom: settledQuery.dateFrom,
        dateTo: settledQuery.dateTo,
        entryType: settledQuery.entryType,
      }
    : filtersState;

  function navigate(changes: Record<string, string | number | null>, delay = 0): void {
    navigation.navigate(
      Object.fromEntries(
        Object.entries({ page: 1, ...changes }).map(([key, value]) => [`${section}_${key}`, value]),
      ),
      delay,
    );
  }

  const handleSort = useCallback(
    (col: SortColumn) => {
      if (col === sortColumn) {
        setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
      } else {
        setSortColumn(col);
        setSortDirection(firstSortDirection);
      }
    },
    [sortColumn, sortDirection, firstSortDirection],
  );

  function changeSearch(value: string): void {
    setSearch(value);
    if (pagination) navigate({ q: value }, 250);
  }

  function changeFilters(value: FilterState): void {
    setFilters(value);
    if (pagination) {
      navigate({
        clients: value.clientIds.join(','),
        employees: value.employeeIds.join(','),
        from: value.dateFrom,
        to: value.dateTo,
        type: value.entryType,
      });
    }
  }

  function changeSort(column: SortColumn): void {
    handleSort(column);
    if (pagination) {
      navigate({
        sort: column,
        direction: column === sortColumn ? (sortDirection === 'asc' ? 'desc' : 'asc') : firstSortDirection,
      });
    }
  }

  return { search, filters, sortColumn, sortDirection, changeSearch, changeFilters, changeSort, navigate };
}
