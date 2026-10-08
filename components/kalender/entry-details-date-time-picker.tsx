'use client';

import { useState } from 'react';
import { Clock } from 'lucide-react';

import { DatePicker } from '@/components/ui/date-picker';
import { Field } from '@/components/ui/field';
import { TimeInput } from '@/components/ui/time-input';
import { toLocalTimeOfDay } from '@/lib/utils';

type EntryDetailsDateTimePickerProps = {
  value: Date;
  onChange: (date: Date) => void;
  label: string;
  dateLabel?: string | undefined;
  disableDateEditing?: boolean;
};

export function EntryDetailsDateTimePicker({
  value,
  onChange,
  label,
  dateLabel,
  disableDateEditing = false,
}: EntryDetailsDateTimePickerProps) {
  const [timeValue, setTimeValue] = useState(toLocalTimeOfDay(value));

  // Adopted during render, never in an effect (realtime-and-caching checklist).
  const [adoptedValue, setAdoptedValue] = useState(value);
  if (value !== adoptedValue) {
    setAdoptedValue(value);
    setTimeValue(toLocalTimeOfDay(value));
  }

  const handleDateChange = (newDate: Date | undefined) => {
    if (!newDate) return;
    const updated = new Date(value);
    updated.setFullYear(newDate.getFullYear());
    updated.setMonth(newDate.getMonth());
    updated.setDate(newDate.getDate());
    onChange(updated);
  };

  const handleTimeChange = (newTime: string) => {
    setTimeValue(newTime);
    const [hours, minutes] = newTime.split(':').map(Number);
    if (hours !== undefined && minutes !== undefined && !isNaN(hours) && !isNaN(minutes)) {
      const newDate = new Date(value);
      newDate.setHours(hours);
      newDate.setMinutes(minutes);
      onChange(newDate);
    }
  };

  return (
    <Field label={label}>
      <div className="flex gap-2">
        <div className="flex-1">
          {disableDateEditing ? (
            <div className="flex h-10 items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground">
              {dateLabel ?? value.toLocaleDateString('de-DE')}
            </div>
          ) : (
            <DatePicker value={value} onChange={handleDateChange} />
          )}
        </div>
        <div className="relative w-28">
          <Clock className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-foreground/80" />
          <TimeInput value={timeValue} onChange={handleTimeChange} className="pl-10 pr-2" />
        </div>
      </div>
    </Field>
  );
}
