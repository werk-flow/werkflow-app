'use client';

import { DatePicker } from '@/components/ui/date-picker';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TimeInput } from '@/components/ui/time-input';
import { toLocalDateString } from '@/lib/utils';
import { JOB_PRIORITY_OPTIONS } from '@/components/auftraege/forms/job-form-options';
import type { ConvertRequestForm } from './use-convert-request-form';

/** Fields only a job has: location, priority and the optional planned date and time. */
export function ConvertRequestJobFields({ form }: { form: ConvertRequestForm }) {
  const {
    location,
    setLocation,
    priority,
    setPriority,
    plannedDate,
    setPlannedDate,
    plannedTime,
    setPlannedTime,
    isLoading,
  } = form;

  return (
    <>
      <Field label="Ort" htmlFor="convert-location">
        <Input
          placeholder="Straße, PLZ Ort"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          disabled={isLoading}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Priorität" htmlFor="convert-priority">
          <Select
            value={priority}
            onValueChange={(value) => {
              const option = JOB_PRIORITY_OPTIONS.find((candidate) => candidate.value === value);
              if (option) setPriority(option.value);
            }}
            disabled={isLoading}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {JOB_PRIORITY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Geplantes Datum" htmlFor="convert-date">
          <DatePicker
            ariaLabel="Geplantes Datum"
            value={
              plannedDate
                ? new Date(
                    Number(plannedDate.slice(0, 4)),
                    Number(plannedDate.slice(5, 7)) - 1,
                    Number(plannedDate.slice(8, 10)),
                  )
                : undefined
            }
            onChange={(date) => setPlannedDate(date ? toLocalDateString(date) : '')}
            disabled={isLoading}
          />
        </Field>
      </div>
      {plannedDate && (
        <Field label="Geplante Uhrzeit" htmlFor="convert-time">
          <TimeInput value={plannedTime} onChange={setPlannedTime} disabled={isLoading} />
        </Field>
      )}
      {!plannedDate && (
        <p className="text-xs text-muted-foreground">
          Ohne Datum bleibt der Auftrag ungeplant und steht unter „Aufträge“ bei den aktuellen Aufträgen. Dort
          planst du ihn später ein oder parkst ihn bewusst. Nichts wird automatisch terminiert.
        </p>
      )}
    </>
  );
}
