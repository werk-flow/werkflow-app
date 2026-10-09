'use client';

import { useJobEntityOptions } from '@/hooks/use-job-entity-options';
import { useState, useEffect, useRef } from 'react';
import { SlidersHorizontal } from 'lucide-react';

import { SearchInput } from '@/components/ui/search-input';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { EMPTY_FILTER_STATE, countActiveFilters, type FilterState } from '@/lib/jobs/types';
import type { OrgMemberOption } from '../shared/employee-multi-select';
import { FilterBarActiveChips } from './filter-bar-active-chips';
import { FilterBarFields } from './filter-bar-fields';

interface FilterBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  members: OrgMemberOption[];
  /** When set, the employee filter shows a locked, read-only field with this label instead of a selectable popover. */
  lockedEmployeeLabel?: string | undefined;
  /** When set, the client filter shows a locked, read-only field with this label instead of a selectable popover. */
  lockedClientLabel?: string | undefined;
}

export function FilterBar({
  searchQuery,
  onSearchChange,
  filters,
  onFiltersChange,
  members,
  lockedEmployeeLabel,
  lockedClientLabel,
}: FilterBarProps) {
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const [panelOpen, setPanelOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Adopted during render, never in an effect (realtime-and-caching checklist).
  const [adoptedSearchQuery, setAdoptedSearchQuery] = useState(searchQuery);
  if (searchQuery !== adoptedSearchQuery) {
    setAdoptedSearchQuery(searchQuery);
    setLocalSearch(searchQuery);
  }

  // A pending search must not fire after leaving the page: it would navigate back to the list.
  useEffect(
    () => () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    },
    [],
  );

  const handleSearchInput = (value: string) => {
    setLocalSearch(value);
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onSearchChange(value);
    }, 300);
  };

  const activeCount = countActiveFilters(filters);

  const handleFilterToggle = () => {
    if (window.innerWidth < 768) {
      setSheetOpen(true);
    } else {
      setPanelOpen((v) => !v);
    }
  };

  const clearAllFilters = () => {
    onFiltersChange(EMPTY_FILTER_STATE);
  };

  const updateFilter = <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const customerSearch = useJobEntityOptions({ kind: 'clients', purpose: 'filter' }, filters.clientIds);

  const filterFields = (
    <FilterBarFields
      filters={filters}
      updateFilter={updateFilter}
      customerSearch={customerSearch}
      members={members}
      lockedEmployeeLabel={lockedEmployeeLabel}
      lockedClientLabel={lockedClientLabel}
    />
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <SearchInput
          wrapperClassName="flex-1"
          placeholder="Suche nach Titel, Nummer, Kunde, Ort…"
          aria-label="Aufträge durchsuchen"
          value={localSearch}
          onValueChange={(value) => {
            if (value) {
              handleSearchInput(value);
              return;
            }
            if (debounceRef.current !== null) clearTimeout(debounceRef.current);
            setLocalSearch('');
            onSearchChange('');
          }}
        />
        <Button
          variant={activeCount > 0 ? 'default' : 'outline'}
          size="sm"
          className="h-9 gap-1.5 shrink-0"
          onClick={handleFilterToggle}
        >
          <SlidersHorizontal className="size-4" />
          <span className="sr-only sm:not-sr-only">Filter</span>
          {activeCount > 0 && (
            <span className="flex size-5 items-center justify-center rounded-full bg-primary-foreground text-[10px] font-bold text-primary">
              {activeCount}
            </span>
          )}
        </Button>
      </div>

      {/* Desktop filter panel */}
      {panelOpen && (
        <div className="hidden rounded-lg border bg-card p-3 md:block" role="region" aria-label="Filter">
          {filterFields}
        </div>
      )}

      {/* Mobile filter sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto rounded-t-xl pb-8">
          <SheetHeader className="mb-4">
            <SheetTitle>Filter</SheetTitle>
            <SheetDescription>Filtere Aufträge und Projekte</SheetDescription>
          </SheetHeader>
          {filterFields}
        </SheetContent>
      </Sheet>

      {activeCount > 0 && (
        <FilterBarActiveChips
          filters={filters}
          customerOptions={customerSearch.options}
          members={members}
          updateFilter={updateFilter}
          clearDateRange={() => onFiltersChange({ ...filters, dateFrom: '', dateTo: '' })}
          clearAllFilters={clearAllFilters}
        />
      )}
    </div>
  );
}
