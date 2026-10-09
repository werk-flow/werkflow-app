'use client';

import { PlainButton } from '@/components/ui/plain-button';
import { X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import type { FilterState } from '@/lib/jobs/types';
import type { JobEntityOption } from '@/lib/jobs/option-types';
import { formatGermanDate } from '@/lib/utils';
import type { OrgMemberOption } from '../shared/employee-multi-select';

type FilterBarActiveChipsProps = {
  filters: FilterState;
  /** The customer search's options; they keep the selected customers' labels. */
  customerOptions: JobEntityOption[];
  members: OrgMemberOption[];
  updateFilter: <K extends keyof FilterState>(key: K, value: FilterState[K]) => void;
  /** Clears both ends of the date range in one change; two `updateFilter` calls would race. */
  clearDateRange: () => void;
  clearAllFilters: () => void;
};

/** One removable chip per active filter, plus the reset for all of them. */
export function FilterBarActiveChips({
  filters,
  customerOptions,
  members,
  updateFilter,
  clearDateRange,
  clearAllFilters,
}: FilterBarActiveChipsProps) {
  const clientChipLabel =
    filters.clientIds.length === 1
      ? (customerOptions.find((option) => option.value === filters.clientIds[0])?.label ?? '1 Kunde')
      : `${filters.clientIds.length} Kunden`;

  const employeeChipLabel =
    filters.employeeIds.length === 1
      ? (() => {
          const m = members.find((m) => m.userId === filters.employeeIds[0]);
          return m ? `${m.firstName} ${m.lastName}` : '1 Mitarbeiter';
        })()
      : `${filters.employeeIds.length} Mitarbeiter`;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {filters.clientIds.length > 0 && (
        <Badge variant="secondary" className="gap-1 text-xs">
          Kunde: {clientChipLabel}
          <PlainButton
            aria-label="Kundenfilter entfernen"
            onClick={() => updateFilter('clientIds', [])}
            className="ml-0.5 hover:text-destructive"
          >
            <X className="size-3" />
          </PlainButton>
        </Badge>
      )}
      {filters.employeeIds.length > 0 && (
        <Badge variant="secondary" className="gap-1 text-xs">
          Mitarbeiter: {employeeChipLabel}
          <PlainButton
            aria-label="Mitarbeiterfilter entfernen"
            onClick={() => updateFilter('employeeIds', [])}
            className="ml-0.5 hover:text-destructive"
          >
            <X className="size-3" />
          </PlainButton>
        </Badge>
      )}
      {(filters.dateFrom || filters.dateTo) && (
        <Badge variant="secondary" className="gap-1 text-xs">
          Zeitraum: {formatGermanDate(filters.dateFrom, { empty: '…' })} –{' '}
          {formatGermanDate(filters.dateTo, { empty: '…' })}
          <PlainButton
            aria-label="Zeitraumfilter entfernen"
            onClick={clearDateRange}
            className="ml-0.5 hover:text-destructive"
          >
            <X className="size-3" />
          </PlainButton>
        </Badge>
      )}
      {filters.entryType !== 'alle' && (
        <Badge variant="secondary" className="gap-1 text-xs">
          {filters.entryType === 'jobs' ? 'Nur Aufträge' : 'Nur Projekte'}
          <PlainButton
            aria-label="Artfilter entfernen"
            onClick={() => updateFilter('entryType', 'alle')}
            className="ml-0.5 hover:text-destructive"
          >
            <X className="size-3" />
          </PlainButton>
        </Badge>
      )}
      <PlainButton onClick={clearAllFilters} className="text-xs text-muted-foreground hover:text-foreground">
        Alle zurücksetzen
      </PlainButton>
    </div>
  );
}
