'use client';

import { DatePicker } from '@/components/ui/date-picker';
import { TimeInput } from '@/components/ui/time-input';
import { toLocalDateString } from '@/lib/utils';

/**
 * The registry's date-plus-time pair (DatePicker + TimeInput) over one
 * combined `YYYY-MM-DDTHH:mm` string value ('' = unset), the same shape the
 * Berlin wall-time helpers in lib/customer-relationships/date-time use.
 * Setting only one half fills the other with a sensible default (today /
 * 00:00) so the combined value is always parseable.
 */
export function DateTimeField({
  value,
  onChange,
  disabled = false,
  idPrefix,
  dateAriaLabel = 'Datum',
  invalid = false,
  describedById,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Yields `${idPrefix}-date` (picker group) and `${idPrefix}-time` ids. */
  idPrefix: string;
  dateAriaLabel?: string;
  invalid?: boolean;
  describedById?: string;
}) {
  const datePart = value.length >= 10 ? value.slice(0, 10) : '';
  const timePart = value.length >= 16 ? value.slice(11, 16) : '';

  const dateValue = datePart
    ? new Date(
        Number(datePart.slice(0, 4)),
        Number(datePart.slice(5, 7)) - 1,
        Number(datePart.slice(8, 10))
      )
    : undefined;

  function handleDateChange(nextDate: Date | undefined) {
    if (!nextDate) {
      onChange('');
      return;
    }
    onChange(`${toLocalDateString(nextDate)}T${timePart || '00:00'}`);
  }

  function handleTimeChange(nextTime: string) {
    const baseDate = datePart || toLocalDateString(new Date());
    onChange(`${baseDate}T${nextTime}`);
  }

  // Container query, not a viewport breakpoint: the pair lives inside dialogs
  // and two-column grids whose width does not follow the viewport. Below 20rem
  // the time input drops under the date so neither can overflow a phone sheet.
  return (
    <div
      className="@container"
      aria-invalid={invalid || undefined}
      aria-describedby={describedById}
    >
      <div className="grid grid-cols-1 gap-2 @[20rem]:grid-cols-[1fr_auto]">
        <DatePicker
          id={`${idPrefix}-date`}
          value={dateValue}
          onChange={handleDateChange}
          disabled={disabled}
          ariaLabel={dateAriaLabel}
        />
        <TimeInput
          id={`${idPrefix}-time`}
          className="w-full @[20rem]:w-28"
          value={timePart}
          onChange={handleTimeChange}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
