'use client';

import { useMemo } from 'react';

import { SearchableMultiSelect, type SearchableSelectOption } from '@/components/ui/searchable-select';
import { getJobDisplayTitle, type Job } from '@/lib/jobs/types';

interface JobMultiSelectProps {
  jobs: Job[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  disabled?: boolean;
}

export function JobMultiSelect({
  jobs,
  selectedIds,
  onSelectionChange,
  disabled = false,
}: JobMultiSelectProps) {
  const options: SearchableSelectOption[] = useMemo(
    () =>
      jobs.map((j) => ({
        value: j.id,
        label: getJobDisplayTitle(j),
        description: j.jobNumber || undefined,
      })),
    [jobs]
  );

  return (
    <SearchableMultiSelect
      options={options}
      selectedIds={selectedIds}
      onSelectionChange={onSelectionChange}
      placeholder="Aufträge zuweisen"
      selectedLabel={(count) =>
        count === 1 ? '1 Auftrag' : `${count} Aufträge`
      }
      searchPlaceholder="Auftrag suchen..."
      emptyMessage="Kein Auftrag gefunden"
      disabled={disabled}
    />
  );
}
