'use client';

import { Clock } from 'lucide-react';

import type { useJobEntityOptions } from '@/hooks/use-job-entity-options';
import { TimeInput } from '@/components/ui/time-input';
import { Field } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { DatePicker } from '@/components/ui/date-picker';
import type { ManualEntryMode } from '@/components/use-manual-entry-form-draft';

type ManualEntryAssignmentFieldsProps = {
  lockEntryMode: boolean | undefined;
  entryMode: ManualEntryMode;
  setEntryMode: (mode: ManualEntryMode) => void;
  isAdminOrManager: boolean;
  memberError: string | undefined;
  memberOptions: Array<{ value: string; label: string; description: string }>;
  selectedUserId: string;
  setSelectedUserId: (userId: string) => void;
  isLoadingMembers: boolean;
  canAssignJob: boolean;
  jobSearch: ReturnType<typeof useJobEntityOptions>;
  selectedJobId: string;
  setSelectedJobId: (jobId: string) => void;
  isPending: boolean;
};

/** What kind of entry it is, whose it is, and the job it belongs to. */
export function ManualEntryAssignmentFields({
  lockEntryMode,
  entryMode,
  setEntryMode,
  isAdminOrManager,
  memberError,
  memberOptions,
  selectedUserId,
  setSelectedUserId,
  isLoadingMembers,
  canAssignJob,
  jobSearch,
  selectedJobId,
  setSelectedJobId,
  isPending,
}: ManualEntryAssignmentFieldsProps) {
  const isLoadingJobs = jobSearch.loading;

  return (
    <>
      {!lockEntryMode && (
        <Field label="Art des Eintrags">
          <Select value={entryMode} onValueChange={(value) => setEntryMode(value as ManualEntryMode)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="both">Einstempeln & Ausstempeln</SelectItem>
              <SelectItem value="clock_in">Nur Einstempeln</SelectItem>
              <SelectItem value="clock_out">Nur Ausstempeln</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      )}

      {isAdminOrManager && (
        <Field label="Mitarbeiter" htmlFor="manual-entry-member" required error={memberError}>
          <SearchableSelect
            options={memberOptions}
            value={selectedUserId}
            onChange={setSelectedUserId}
            placeholder={isLoadingMembers ? 'Lädt…' : 'Mitarbeiter auswählen'}
            searchPlaceholder="Mitarbeiter suchen…"
            emptyMessage="Kein Mitarbeiter gefunden"
            disabled={isLoadingMembers}
          />
        </Field>
      )}

      {canAssignJob && (
        <Field label="Auftrag (optional)">
          <SearchableSelect
            {...jobSearch}
            value={selectedJobId}
            onChange={(v) => setSelectedJobId(v)}
            placeholder={isLoadingJobs ? 'Lädt…' : 'Kein Auftrag'}
            searchPlaceholder="Auftrag suchen…"
            emptyMessage="Kein Auftrag gefunden"
            disabled={isPending}
            allowNone
            noneLabel="Kein Auftrag"
          />
        </Field>
      )}
    </>
  );
}

type ManualEntryTimeFieldsProps = {
  entryMode: ManualEntryMode;
  dateError: string | undefined;
  selectedDate: Date | undefined;
  setSelectedDate: (date: Date | undefined) => void;
  clockInTime: string;
  setClockInTime: (time: string) => void;
  clockOutTime: string;
  setClockOutTime: (time: string) => void;
};

export function ManualEntryTimeFields({
  entryMode,
  dateError,
  selectedDate,
  setSelectedDate,
  clockInTime,
  setClockInTime,
  clockOutTime,
  setClockOutTime,
}: ManualEntryTimeFieldsProps) {
  return (
    <>
      <Field label="Datum" htmlFor="manual-entry-date" required error={dateError}>
        <DatePicker
          ariaLabel="Datum"
          value={selectedDate}
          onChange={setSelectedDate}
          placeholder="Datum wählen"
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {(entryMode === 'clock_in' || entryMode === 'both') && (
          <Field label="Einstempeln" htmlFor="clockInTime" required>
            <div className="relative">
              <Clock className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-foreground/80" />
              <TimeInput value={clockInTime} onChange={setClockInTime} className="pl-10 pr-3" />
            </div>
          </Field>
        )}
        {(entryMode === 'clock_out' || entryMode === 'both') && (
          <Field label="Ausstempeln" htmlFor="clockOutTime" required>
            <div className="relative">
              <Clock className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-foreground/80" />
              <TimeInput value={clockOutTime} onChange={setClockOutTime} className="pl-10 pr-3" />
            </div>
          </Field>
        )}
      </div>
    </>
  );
}
