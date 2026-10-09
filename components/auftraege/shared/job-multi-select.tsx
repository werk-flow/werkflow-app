'use client';

import type { JobEntityOptionsState } from '@/hooks/use-job-entity-options';
import { SearchableMultiSelect } from '@/components/ui/searchable-select';

interface JobMultiSelectProps {
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  disabled?: boolean;
  /** The server search over the permitted jobs; a preloaded job list is never the option source. */
  search: JobEntityOptionsState;
}

export function JobMultiSelect({
  selectedIds,
  onSelectionChange,
  disabled = false,
  search,
}: JobMultiSelectProps) {
  return (
    <SearchableMultiSelect
      options={search.options}
      onSearchChange={search.onSearchChange}
      loading={search.loading}
      loadError={search.loadError}
      onRetryLoad={search.onRetryLoad}
      onLoadMore={search.onLoadMore}
      selectedIds={selectedIds}
      onSelectionChange={onSelectionChange}
      placeholder="Aufträge zuweisen"
      selectedLabel={(count) => (count === 1 ? '1 Auftrag' : `${count} Aufträge`)}
      searchPlaceholder="Auftrag suchen…"
      emptyMessage="Kein Auftrag gefunden"
      disabled={disabled}
    />
  );
}
