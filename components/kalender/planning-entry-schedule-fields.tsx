'use client';

import type { Dispatch, SetStateAction } from 'react';
import { CalendarDays, Repeat2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import { DurationHoursInput } from '@/components/ui/duration-hours-input';
import { Field } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TimeInput } from '@/components/ui/time-input';
import {
  getMondayWeekday,
  type PlanningRecurrenceEndMode,
  type PlanningRecurrenceFrequency,
  type PlanningTimeKind,
} from '@/lib/calendar/planning-entry-draft';
import type { PlanningConflict } from '@/lib/planning/types';
import { parseIsoLocalDate, toLocalDateString } from '@/lib/utils';

const WEEKDAYS = [
  ['Mo', 0],
  ['Di', 1],
  ['Mi', 2],
  ['Do', 3],
  ['Fr', 4],
  ['Sa', 5],
  ['So', 6],
] as const;

interface PlanningEntryScheduleFieldsProps {
  date: string;
  dateError: string | undefined;
  onDateChange: (date: string) => void;
  onWeekdaysChange: (weekdays: number[]) => void;
  onConflictsChange: (conflicts: PlanningConflict[]) => void;
  timeKind: PlanningTimeKind;
  onTimeKindChange: (timeKind: PlanningTimeKind) => void;
  time: string;
  onTimeChange: (time: string) => void;
  durationHours: string;
  onDurationHoursChange: (durationHours: string) => void;
  durationDays: string;
  onDurationDaysChange: (durationDays: string) => void;
}

/** Date, time kind and either start and duration or calendar days of a new planning entry. */
export function PlanningEntryScheduleFields({
  date,
  dateError,
  onDateChange,
  onWeekdaysChange,
  onConflictsChange,
  timeKind,
  onTimeKindChange,
  time,
  onTimeChange,
  durationHours,
  onDurationHoursChange,
  durationDays,
  onDurationDaysChange,
}: PlanningEntryScheduleFieldsProps) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Datum" htmlFor="planning-date" required error={dateError}>
          <DatePicker
            ariaLabel="Datum des Termins"
            value={parseIsoLocalDate(date)}
            onChange={(nextDate) => {
              const nextIso = nextDate ? toLocalDateString(nextDate) : '';
              onDateChange(nextIso);
              if (nextIso) onWeekdaysChange([getMondayWeekday(nextIso)]);
              onConflictsChange([]);
            }}
          />
        </Field>
        <Field label="Zeitart" htmlFor="planning-time-kind">
          <Select value={timeKind} onValueChange={(value) => onTimeKindChange(value as 'timed' | 'all_day')}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="timed">Mit Uhrzeit</SelectItem>
              <SelectItem value="all_day">Ganztägig / mehrtägig</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {timeKind === 'timed' ? (
          <>
            <Field label="Beginn" htmlFor="planning-time" required>
              <TimeInput value={time} onChange={onTimeChange} />
            </Field>
            <Field label="Dauer" htmlFor="planning-duration" required>
              <DurationHoursInput
                id="planning-duration"
                value={durationHours}
                onChange={onDurationHoursChange}
              />
            </Field>
          </>
        ) : (
          <Field label="Kalendertage" htmlFor="planning-days" required>
            <QuantityStepper
              id="planning-days"
              min={1}
              value={durationDays}
              onChange={onDurationDaysChange}
            />
          </Field>
        )}
      </div>
    </>
  );
}

interface PlanningEntryRecurrenceFieldsProps {
  recurring: boolean;
  onRecurringChange: (recurring: boolean) => void;
  frequency: PlanningRecurrenceFrequency;
  onFrequencyChange: (frequency: PlanningRecurrenceFrequency) => void;
  interval: string;
  onIntervalChange: (interval: string) => void;
  weekdays: number[];
  onWeekdaysChange: Dispatch<SetStateAction<number[]>>;
  endMode: PlanningRecurrenceEndMode;
  onEndModeChange: (endMode: PlanningRecurrenceEndMode) => void;
  occurrenceCount: string;
  onOccurrenceCountChange: (occurrenceCount: string) => void;
  untilDate: string;
  onUntilDateChange: (untilDate: string) => void;
}

/** The „Wiederholen" switch and, while on, the series rhythm, weekdays and end. */
export function PlanningEntryRecurrenceFields({
  recurring,
  onRecurringChange,
  frequency,
  onFrequencyChange,
  interval,
  onIntervalChange,
  weekdays,
  onWeekdaysChange,
  endMode,
  onEndModeChange,
  occurrenceCount,
  onOccurrenceCountChange,
  untilDate,
  onUntilDateChange,
}: PlanningEntryRecurrenceFieldsProps) {
  return (
    <div className="space-y-3 border-t pt-4">
      <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
        <Checkbox checked={recurring} onCheckedChange={(checked) => onRecurringChange(checked === true)} />
        <Repeat2 className="size-4 text-muted-foreground" /> Wiederholen
      </label>
      {recurring && (
        <div className="space-y-4 rounded-lg border bg-muted/20 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Rhythmus" htmlFor="planning-frequency">
              <Select
                value={frequency}
                onValueChange={(value) => onFrequencyChange(value as typeof frequency)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Täglich</SelectItem>
                  <SelectItem value="weekly">Wöchentlich</SelectItem>
                  <SelectItem value="monthly">Monatlich</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Alle" htmlFor="planning-interval">
              <div className="flex items-center gap-2">
                <QuantityStepper
                  id="planning-interval"
                  min={1}
                  className="flex-1"
                  value={interval}
                  onChange={onIntervalChange}
                />
                <span className="text-sm text-muted-foreground">
                  {frequency === 'daily' ? 'Tage' : frequency === 'weekly' ? 'Wochen' : 'Monate'}
                </span>
              </div>
            </Field>
          </div>
          {frequency === 'weekly' && (
            <div className="space-y-2">
              <Label id="planning-weekdays-label">Wochentage</Label>
              <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="planning-weekdays-label">
                {WEEKDAYS.map(([label, value]) => (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={weekdays.includes(value) ? 'secondary' : 'outline'}
                    className="size-8 p-0"
                    aria-pressed={weekdays.includes(value)}
                    onClick={() =>
                      onWeekdaysChange((days) =>
                        days.includes(value) ? days.filter((day) => day !== value) : [...days, value].sort(),
                      )
                    }
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Ende" htmlFor="planning-end-mode">
              <Select value={endMode} onValueChange={(value) => onEndModeChange(value as typeof endMode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="count">Nach Anzahl</SelectItem>
                  <SelectItem value="until">An Datum</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {endMode === 'count' ? (
              <Field label="Termine" htmlFor="planning-count">
                <QuantityStepper
                  id="planning-count"
                  min={2}
                  value={occurrenceCount}
                  onChange={onOccurrenceCountChange}
                />
              </Field>
            ) : (
              <Field label="Letztes Datum" htmlFor="planning-until">
                <DatePicker
                  ariaLabel="Letztes Datum der Serie"
                  value={parseIsoLocalDate(untilDate)}
                  onChange={(nextDate) => onUntilDateChange(nextDate ? toLocalDateString(nextDate) : '')}
                />
              </Field>
            )}
          </div>
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <CalendarDays className="mt-0.5 size-3.5 shrink-0" />
            WerkFlow plant höchstens 18 Monate im Voraus und erweitert die Serie später ohne Duplikate.
          </p>
        </div>
      )}
    </div>
  );
}
