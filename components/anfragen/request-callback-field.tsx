'use client';

import { Button } from '@/components/ui/button';
import { DateTimeField } from '@/components/ui/date-time-field';
import { Field } from '@/components/ui/field';
import { formatBerlinDateTimeInput, tomorrowMorningInBerlin } from '@/lib/date-time/berlin';

const HOUR_MS = 60 * 60 * 1000;

/** The promises an office makes most on a call, as `YYYY-MM-DDTHH:mm` in Berlin time. */
const CALLBACK_CHOICES: ReadonlyArray<{ label: string; value: () => string }> = [
  { label: 'In 1 Stunde', value: () => formatBerlinDateTimeInput(new Date(Date.now() + HOUR_MS)) },
  { label: 'In 2 Stunden', value: () => formatBerlinDateTimeInput(new Date(Date.now() + 2 * HOUR_MS)) },
  { label: 'Morgen 9 Uhr', value: () => tomorrowMorningInBerlin() },
];

interface RequestCallbackFieldProps {
  /** `request` in the create dialog, `edit-request` in the edit dialog. */
  idPrefix: 'request' | 'edit-request';
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  disabled: boolean;
}

/** „Rückruf bis“: a quick choice or an exact time; empty means no promise was made. */
export function RequestCallbackField({
  idPrefix,
  value,
  onChange,
  error,
  disabled,
}: RequestCallbackFieldProps) {
  return (
    <Field label="Rückruf bis" htmlFor={`${idPrefix}-callback-date`} error={error}>
      <div className="grid gap-2">
        <div className="flex flex-wrap gap-2">
          {CALLBACK_CHOICES.map((choice) => (
            <Button
              key={choice.label}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onChange(choice.value())}
              disabled={disabled}
            >
              {choice.label}
            </Button>
          ))}
          {value && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange('')} disabled={disabled}>
              Kein Rückruf
            </Button>
          )}
        </div>
        <DateTimeField
          idPrefix={`${idPrefix}-callback`}
          value={value}
          onChange={onChange}
          disabled={disabled}
          dateAriaLabel="Rückrufdatum"
          invalid={error !== null}
          describedById={error ? `${idPrefix}-callback-date-error` : undefined}
        />
      </div>
    </Field>
  );
}
