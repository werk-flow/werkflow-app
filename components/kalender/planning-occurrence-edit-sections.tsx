'use client';

import { AlertTriangle, Loader2, Repeat2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { DurationHoursInput } from '@/components/ui/duration-hours-input';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { SearchableMultiSelect } from '@/components/ui/searchable-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { TimeInput } from '@/components/ui/time-input';
import type { usePlanningOptions } from '@/hooks/use-planning-options';
import type { PlanningTimeKind } from '@/lib/calendar/planning-entry-draft';
import type { PlanningEditScope, PlanningStatusIntent } from '@/lib/calendar/planning-occurrence-edit';
import type { PlanningConflict } from '@/lib/planning/types';
import { formatGermanDate, parseIsoLocalDate, toLocalDateString } from '@/lib/utils';
import type { usePlanningSeriesExtension } from './use-planning-series-extension';

interface PlanningSeriesScopeFieldProps {
  scope: PlanningEditScope;
  onScopeChange: (scope: PlanningEditScope) => void;
  onConflictsChange: (conflicts: PlanningConflict[]) => void;
  extension: ReturnType<typeof usePlanningSeriesExtension>;
}

/** The change scope of a series occurrence and the series horizon extension with its own warnings. */
export function PlanningSeriesScopeField({
  scope,
  onScopeChange,
  onConflictsChange,
  extension,
}: PlanningSeriesScopeFieldProps) {
  const { extending, extendError, extendConflicts, extendReason, extendReasonError } = extension;
  return (
    <Field label="Änderungsumfang" htmlFor="planning-edit-scope">
      <Select
        value={scope}
        onValueChange={(value) => {
          onScopeChange(value as typeof scope);
          onConflictsChange([]);
        }}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="one">Nur dieser Termin</SelectItem>
          <SelectItem value="future">Dieser und zukünftige</SelectItem>
          <SelectItem value="series">Ganze Serie ab frühestem änderbaren Termin</SelectItem>
        </SelectContent>
      </Select>
      {scope !== 'one' && (
        <p className="flex gap-1.5 text-xs text-muted-foreground">
          <Repeat2 className="mt-0.5 size-3.5 shrink-0" />
          Vergangene, begonnene und einzeln angepasste Termine bleiben erhalten. „Dieser und zukünftige“
          erzeugt einen nachvollziehbaren Serienabschnitt.
        </p>
      )}
      <div className="space-y-2 rounded-md border bg-muted/20 p-2.5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">Die Serie ist zunächst 18 Monate im Voraus geplant.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={extending}
            onClick={() => void extension.handleExtendSeries()}
          >
            {extending && <Loader2 className="size-4 animate-spin" />}
            {extending
              ? 'Wird verlängert …'
              : extendConflicts.length > 0
                ? 'Mit Begründung verlängern'
                : 'Serie um sechs Monate verlängern'}
          </Button>
        </div>
        <ErrorText>{extendError}</ErrorText>
        {extendConflicts.length > 0 && (
          <div
            data-planning-warning
            role="status"
            className="space-y-2 rounded-md border border-warning/40 bg-warning-soft p-2.5"
          >
            <p className="text-sm font-medium">Planungshinweise</p>
            <ul className="space-y-1 text-sm">
              {extendConflicts.map((conflict, index) => (
                <li key={`extend-${conflict.kind}-${index}`}>
                  • {conflict.employeeName ? `${conflict.employeeName}: ` : ''}
                  {conflict.message}
                  {conflict.localDate ? ` (${formatGermanDate(conflict.localDate)})` : ''}
                </li>
              ))}
            </ul>
            <Field label="Begründung" htmlFor="planning-extend-reason" required error={extendReasonError}>
              <Textarea
                value={extendReason}
                onChange={(event) => extension.setExtendReason(event.target.value)}
                placeholder="Warum ist die Verlängerung trotzdem sinnvoll?"
              />
            </Field>
          </div>
        )}
      </div>
    </Field>
  );
}

interface PlanningOccurrenceScheduleFieldsProps {
  timeKind: PlanningTimeKind | undefined;
  date: string;
  dateError: string | undefined;
  onDateChange: (date: string) => void;
  time: string;
  onTimeChange: (time: string) => void;
  durationHours: string;
  durationError: string | undefined;
  onDurationHoursChange: (durationHours: string) => void;
  employeeSelect: ReturnType<typeof usePlanningOptions>['select'];
  employeeRecordIds: string[];
  onEmployeeRecordIdsChange: (employeeRecordIds: string[]) => void;
  onConflictsChange: (conflicts: PlanningConflict[]) => void;
}

/** Date, start, duration and employees of one occurrence; every change clears the shown warnings. */
export function PlanningOccurrenceScheduleFields({
  timeKind,
  date,
  dateError,
  onDateChange,
  time,
  onTimeChange,
  durationHours,
  durationError,
  onDurationHoursChange,
  employeeSelect,
  employeeRecordIds,
  onEmployeeRecordIdsChange,
  onConflictsChange,
}: PlanningOccurrenceScheduleFieldsProps) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Datum" htmlFor="planning-edit-date" required error={dateError}>
          <DatePicker
            ariaLabel="Datum des Termins"
            value={parseIsoLocalDate(date)}
            onChange={(nextDate) => {
              onDateChange(nextDate ? toLocalDateString(nextDate) : '');
              onConflictsChange([]);
            }}
          />
        </Field>
        {timeKind !== 'all_day' && (
          <Field label="Beginn" htmlFor="planning-edit-time" required>
            <TimeInput
              value={time}
              onChange={(nextTime) => {
                onTimeChange(nextTime);
                onConflictsChange([]);
              }}
            />
          </Field>
        )}
      </div>
      {timeKind !== 'all_day' && (
        <Field label="Dauer" htmlFor="planning-edit-duration" required error={durationError}>
          <DurationHoursInput
            id="planning-edit-duration"
            value={durationHours}
            onChange={(nextValue) => {
              onDurationHoursChange(nextValue);
              onConflictsChange([]);
            }}
          />
        </Field>
      )}
      <Field label="Mitarbeiter" htmlFor="planning-edit-employees" error={employeeSelect.loadError}>
        <SearchableMultiSelect
          {...employeeSelect}
          selectedIds={employeeRecordIds}
          onSelectionChange={(ids) => {
            onEmployeeRecordIdsChange(ids);
            onConflictsChange([]);
          }}
          placeholder="Mitarbeiter zuweisen"
          selectedLabel={(count) => (count === 1 ? '1 Mitarbeiter' : `${count} Mitarbeiter`)}
          searchPlaceholder="Mitarbeiter suchen …"
          emptyMessage="Kein Mitarbeiter gefunden"
        />
      </Field>
    </>
  );
}

interface PlanningOccurrenceConflictWarningProps {
  conflicts: PlanningConflict[];
  reason: string;
  reasonError: string | undefined;
  onReasonChange: (reason: string) => void;
}

/** The planning warnings of the last edit check and the reason that overrides them. */
export function PlanningOccurrenceConflictWarning({
  conflicts,
  reason,
  reasonError,
  onReasonChange,
}: PlanningOccurrenceConflictWarningProps) {
  return (
    <div
      data-planning-warning
      role="status"
      className="space-y-3 rounded-lg border border-warning/40 bg-warning-soft p-3"
    >
      <p className="flex items-center gap-2 font-medium">
        <AlertTriangle className="size-4 text-warning-text" />
        Planungshinweise
      </p>
      <ul className="space-y-1 text-sm">
        {conflicts.map((conflict, index) => (
          <li key={`${conflict.kind}-${index}`}>
            • {conflict.employeeName ? `${conflict.employeeName}: ` : ''}
            {conflict.message}
            {conflict.localDate ? ` (${formatGermanDate(conflict.localDate)})` : ''}
          </li>
        ))}
      </ul>
      <Field
        label="Begründung"
        htmlFor="planning-edit-reason"
        required
        description="Mindestens 8 Zeichen."
        error={reasonError}
      >
        <Textarea
          value={reason}
          onChange={(event) => onReasonChange(event.target.value)}
          placeholder="Warum ist die Änderung trotzdem sinnvoll?"
        />
      </Field>
    </div>
  );
}

interface PlanningOccurrenceStatusPanelProps {
  statusIntent: PlanningStatusIntent;
  onStatusIntentChange: (statusIntent: PlanningStatusIntent | null) => void;
  reason: string;
  reasonError: string | undefined;
  onReasonChange: (reason: string) => void;
  onSubmitErrorChange: (submitError: string | null) => void;
}

/** The reason step of skipping or cancelling one occurrence, with the way back to editing. */
export function PlanningOccurrenceStatusPanel({
  statusIntent,
  onStatusIntentChange,
  reason,
  reasonError,
  onReasonChange,
  onSubmitErrorChange,
}: PlanningOccurrenceStatusPanelProps) {
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium">
          {statusIntent === 'skipped' ? 'Diesen Termin auslassen' : 'Diesen Termin absagen'}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            onStatusIntentChange(null);
            onReasonChange('');
            onSubmitErrorChange(null);
          }}
        >
          Zurück zum Bearbeiten
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Der Termin bleibt für Verlauf und Nachvollziehbarkeit erhalten und wird nicht gelöscht.
      </p>
      <Field
        label="Begründung"
        htmlFor="planning-status-reason"
        required
        description="Mindestens 8 Zeichen."
        error={reasonError}
      >
        <Textarea
          value={reason}
          onChange={(event) => onReasonChange(event.target.value)}
          placeholder="Kurze nachvollziehbare Begründung"
        />
      </Field>
    </div>
  );
}
