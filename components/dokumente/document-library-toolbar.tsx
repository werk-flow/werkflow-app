'use client';

import { useState, type ReactNode } from 'react';
import { SlidersHorizontal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/search-input';
import type {
  DocumentLibraryCategoryFilter,
  DocumentLibraryLinkFilter,
  DocumentLibraryView,
} from '@/lib/documents/types';
import { DocumentLibraryFilterPanel } from './document-library-filter-panel';

type DocumentLibraryToolbarProps = {
  visibleView: DocumentLibraryView;
  searchQuery: string;
  category: DocumentLibraryCategoryFilter;
  linkFilter: DocumentLibraryLinkFilter;
  /** The view buttons and the trash button, rendered above the search row. */
  viewSwitch: ReactNode;
  /** The batch actions of the current selection, or nothing. */
  selectionActions: ReactNode;
  onSearchQueryChange: (searchQuery: string) => void;
  /** Applies the typed query; without an argument the current field value. */
  onSubmitSearch: (query?: string) => void;
  onCategoryChange: (category: DocumentLibraryCategoryFilter) => void;
  onLinkFilterChange: (linkFilter: DocumentLibraryLinkFilter) => void;
};

/** The library's toolbar card: view switch, search, selection actions and the filter panel. */
export function DocumentLibraryToolbar({
  visibleView,
  searchQuery,
  category,
  linkFilter,
  viewSwitch,
  selectionActions,
  onSearchQueryChange,
  onSubmitSearch,
  onCategoryChange,
  onLinkFilterChange,
}: DocumentLibraryToolbarProps) {
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const activeFilterCount = (category !== 'all' ? 1 : 0) + (linkFilter !== 'all' ? 1 : 0);

  return (
    <div className="space-y-3 rounded-lg border bg-card p-3">
      {viewSwitch}

      <div className="flex flex-col gap-2 lg:flex-row lg:items-start">
        <form
          className="min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmitSearch();
          }}
        >
          <SearchInput
            value={searchQuery}
            onValueChange={(value) => {
              onSearchQueryChange(value);
              // Clearing the field shows the whole library again without a second step.
              if (!value) onSubmitSearch('');
            }}
            placeholder="Dokumente suchen…"
            aria-label="Dokumente suchen"
          />
        </form>

        {selectionActions}

        <Button
          type="button"
          variant={filterPanelOpen ? 'secondary' : 'outline'}
          onClick={() => setFilterPanelOpen((current) => !current)}
          className="h-9 shrink-0"
        >
          <SlidersHorizontal className="size-4" />
          <span className="sr-only sm:not-sr-only">Filter</span>
          {activeFilterCount > 0 && (
            <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
              {activeFilterCount}
            </span>
          )}
        </Button>
      </div>

      {filterPanelOpen && (
        <DocumentLibraryFilterPanel
          visibleView={visibleView}
          category={category}
          linkFilter={linkFilter}
          onCategoryChange={onCategoryChange}
          onLinkFilterChange={onLinkFilterChange}
        />
      )}
    </div>
  );
}
