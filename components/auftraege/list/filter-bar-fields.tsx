'use client';

import type { useJobEntityOptions } from '@/hooks/use-job-entity-options';
import { SearchableMultiSelect } from '@/components/ui/searchable-select';

import { DatePicker } from '@/components/ui/date-picker';
import { Field } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { FilterState, EntryTypeFilter } from '@/lib/jobs/types';
import type { OrgMemberOption } from '../shared/employee-multi-select';
import { toLocalDateString } from '@/lib/utils';

type FilterBarFieldsProps = {
  filters: FilterState;
  updateFilter: <K extends keyof FilterState>(key: K, value: FilterState[K]) => void;
  customerSearch: ReturnType<typeof useJobEntityOptions>;
  members: OrgMemberOption[];
  lockedEmployeeLabel: string | undefined;
  lockedClientLabel: string | undefined;
};

/**
 * The filter controls, shown in the desktop panel and in the mobile sheet.
 * Every `Field` generates its control id, so both copies can be mounted at once.
 */
export function FilterBarFields({
  filters,
  updateFilter,
  customerSearch,
  members,
  lockedEmployeeLabel,
  lockedClientLabel,
}: FilterBarFieldsProps) {
  const memberOptions = members.map((m) => ({ value: m.userId, label: `${m.firstName} ${m.lastName}` }));

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Kunde" className="gap-1.5">
        <SearchableMultiSelect
          {...customerSearch}
          selectedIds={filters.clientIds}
          onSelectionChange={(ids) => updateFilter('clientIds', ids)}
          placeholder="Alle Kunden"
          searchPlaceholder="Kunde suchen…"
          readOnly={Boolean(lockedClientLabel)}
          readOnlyLabel={lockedClientLabel}
        />
      </Field>

      <Field label="Mitarbeiter" className="gap-1.5">
        <SearchableMultiSelect
          options={memberOptions}
          selectedIds={filters.employeeIds}
          onSelectionChange={(ids) => updateFilter('employeeIds', ids)}
          placeholder="Alle Mitarbeiter"
          searchPlaceholder="Mitarbeiter suchen…"
          readOnly={Boolean(lockedEmployeeLabel)}
          readOnlyLabel={lockedEmployeeLabel}
        />
      </Field>

      <Field label="Datum von" className="gap-1.5">
        <DatePicker
          value={filters.dateFrom ? new Date(filters.dateFrom + 'T00:00:00') : undefined}
          onChange={(d) => updateFilter('dateFrom', d ? toLocalDateString(d) : '')}
          placeholder="Von"
        />
      </Field>

      <Field label="Datum bis" className="gap-1.5">
        <DatePicker
          value={filters.dateTo ? new Date(filters.dateTo + 'T00:00:00') : undefined}
          onChange={(d) => updateFilter('dateTo', d ? toLocalDateString(d) : '')}
          placeholder="Bis"
        />
      </Field>

      <Field label="Typ" className="gap-1.5 sm:col-span-2">
        <Select
          value={filters.entryType}
          onValueChange={(v) => updateFilter('entryType', v as EntryTypeFilter)}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="alle">Alle</SelectItem>
            <SelectItem value="jobs">Nur Aufträge</SelectItem>
            <SelectItem value="projekte">Nur Projekte</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}
