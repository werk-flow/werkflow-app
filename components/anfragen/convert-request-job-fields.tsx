'use client';

import { DatePicker } from '@/components/ui/date-picker';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TimeInput } from '@/components/ui/time-input';
import { JOB_PRIORITY_LABELS, type JobPriority } from '@/lib/jobs/types';
import { toLocalDateString } from '@/lib/utils';
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
            onValueChange={(value) => setPriority(value as JobPriority)}
            disabled={isLoading}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(JOB_PRIORITY_LABELS) as JobPriority[]).map((value) => (
                <SelectItem key={value} value={value}>
                  {JOB_PRIORITY_LABELS[value]}
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
          Ohne Datum landet der Auftrag im Parkplatz und kann später eingeplant werden. Es wird nichts
          automatisch terminiert.
        </p>
      )}
    </>
  );
}
