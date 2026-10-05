'use client';

import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { InlinePending } from '@/components/ui/inline-pending';
import { RefreshButton } from '@/components/ui/refresh-button';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DatePicker } from '@/components/ui/date-picker';

export interface EntryHistoryMemberInfo {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: string;
}

type EntryHistoryFiltersProps = {
  dateFrom: Date | undefined;
  setDateFrom: (date: Date | undefined) => void;
  dateTo: Date | undefined;
  setDateTo: (date: Date | undefined) => void;
  members: EntryHistoryMemberInfo[];
  memberFilter: string;
  setMemberFilter: (value: string) => void;
  statusFilter: string;
  setStatusFilter: (value: string) => void;
  onRefresh: () => Promise<void>;
  hydrated: boolean;
  onAddTime: () => void;
  isSettlingNewEntry: boolean;
};

export function EntryHistoryFilters({
  dateFrom,
  setDateFrom,
  dateTo,
  setDateTo,
  members,
  memberFilter,
  setMemberFilter,
  statusFilter,
  setStatusFilter,
  onRefresh,
  hydrated,
  onAddTime,
  isSettlingNewEntry,
}: EntryHistoryFiltersProps) {
  // Helper to get member display name
  const getMemberDisplayName = (member: EntryHistoryMemberInfo): string => {
    if (member.first_name || member.last_name) {
      return `${member.first_name || ''} ${member.last_name || ''}`.trim();
    }
    return member.email;
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:flex-wrap">
      <Field label="Von" className="flex-1 min-w-[140px] gap-1">
        <DatePicker value={dateFrom} onChange={setDateFrom} placeholder="Von" ariaLabel="Von" />
      </Field>
      <Field label="Bis" className="flex-1 min-w-[140px] gap-1">
        <DatePicker value={dateTo} onChange={setDateTo} placeholder="Bis" ariaLabel="Bis" />
      </Field>
      {members.length > 0 && (
        <Field label="Mitarbeiter" className="flex-1 min-w-[180px] gap-1">
          <SearchableSelect
            ariaLabel="Nach Mitarbeiter filtern"
            options={[
              { value: 'all', label: 'Alle Mitarbeiter' },
              ...members.map((member) => ({
                value: member.user_id,
                label: getMemberDisplayName(member),
              })),
            ]}
            value={memberFilter}
            onChange={setMemberFilter}
            searchPlaceholder="Mitarbeiter suchen …"
            emptyMessage="Kein Mitarbeiter gefunden"
          />
        </Field>
      )}
      <Field label="Status" className="flex-1 min-w-[140px] gap-1">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle</SelectItem>
            <SelectItem value="approved">Genehmigt</SelectItem>
            <SelectItem value="pending">Ausstehend</SelectItem>
            <SelectItem value="rejected">Abgelehnt</SelectItem>
            <SelectItem value="pending_delete">Löschung ausstehend</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <RefreshButton onRefresh={onRefresh} label="Einträge aktualisieren" />
      <Button variant="outline" size="sm" disabled={!hydrated} onClick={onAddTime}>
        <Plus className="mr-1.5 size-4" /> Zeit nachtragen
      </Button>
      <InlinePending active={isSettlingNewEntry} />
    </div>
  );
}
