'use client';

import { useMemo } from 'react';

import { SearchableMultiSelect, type SearchableSelectOption } from '@/components/ui/searchable-select';

export type OrgMemberOption = {
  userId: string;
  firstName: string;
  lastName: string;
  role?: string;
};

interface EmployeeMultiSelectProps {
  members: OrgMemberOption[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  disabled?: boolean;
}

function getMemberName(m: OrgMemberOption): string {
  const name = `${m.firstName} ${m.lastName}`.trim();
  return name || 'Unbenannt';
}

export function EmployeeMultiSelect({
  members,
  selectedIds,
  onSelectionChange,
  disabled = false,
}: EmployeeMultiSelectProps) {
  const options: SearchableSelectOption[] = useMemo(
    () =>
      members.map((m) => ({
        value: m.userId,
        label: getMemberName(m),
      })),
    [members]
  );

  return (
    <SearchableMultiSelect
      options={options}
      selectedIds={selectedIds}
      onSelectionChange={onSelectionChange}
      placeholder="Mitarbeiter zuweisen"
      selectedLabel={(count) =>
        count === 1 ? '1 Mitarbeiter' : `${count} Mitarbeiter`
      }
      searchPlaceholder="Mitarbeiter suchen..."
      emptyMessage="Kein Mitarbeiter gefunden"
      disabled={disabled}
    />
  );
}
