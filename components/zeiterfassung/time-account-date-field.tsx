'use client';

import { useState } from 'react';
import { DatePicker } from '@/components/ui/date-picker';
import { toLocalDateString } from '@/lib/utils';

function parseDate(value: string): Date {
  return new Date(`${value}T12:00:00`);
}

export function TimeAccountDateField({
  name,
  initialValue,
  ariaLabel,
  form,
}: {
  name: string;
  initialValue: string;
  ariaLabel: string;
  /** The id of the form this value belongs to when the field sits outside it (a table cell). */
  form?: string;
}) {
  const [value, setValue] = useState<Date | undefined>(() => parseDate(initialValue));
  return (
    <>
      <input type="hidden" form={form} name={name} value={value ? toLocalDateString(value) : ''} />
      <DatePicker value={value} onChange={setValue} ariaLabel={ariaLabel} />
    </>
  );
}
