'use client';

import { useMemo, useState } from 'react';
import { DatePicker } from '@/components/ui/date-picker';
import { toLocalDateString } from '@/lib/utils';

/**
 * A suggested date until the user picks one. A live refresh that moves the
 * suggestion, such as a month closed in another session, moves an untouched
 * date with it; a picked date, an emptied one included, stays.
 */
export function useSuggestedDate(suggestion: string) {
  const [picked, setPicked] = useState<{ date: Date | undefined } | null>(null);
  // One Date per suggestion, so the picker sees a stable value between renders.
  const suggested = useMemo(() => new Date(`${suggestion}T12:00:00`), [suggestion]);
  const pick = (date: Date | undefined): void => setPicked({ date });
  return [picked ? picked.date : suggested, pick] as const;
}

/** A date of a time-account form, sent through a hidden input; an emptied date is sent empty. */
export function TimeAccountDateField({
  name,
  initialValue,
  ariaLabel,
  form,
  id,
  onPick,
}: {
  name: string;
  /** The suggested date, `YYYY-MM-DD`. */
  initialValue: string;
  ariaLabel: string;
  /** The id of the form this value belongs to when the field sits outside it (a table cell). */
  form?: string;
  /** The picker's id, for a form that focuses it when the date is missing. */
  id?: string;
  /** Runs after every pick, an emptied date included. */
  onPick?: (date: Date | undefined) => void;
}) {
  const [value, setPicked] = useSuggestedDate(initialValue);
  const pick = (date: Date | undefined): void => {
    setPicked(date);
    onPick?.(date);
  };
  return (
    <>
      <input type="hidden" form={form} name={name} value={value ? toLocalDateString(value) : ''} />
      <DatePicker {...(id ? { id } : {})} value={value} onChange={pick} ariaLabel={ariaLabel} />
    </>
  );
}
