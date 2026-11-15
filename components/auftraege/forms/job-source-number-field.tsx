'use client';

import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

/** The optional number the previous system gave the job, in the create and edit dialogs. */
export function JobSourceNumberField({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <Field label="Nummer im Altsystem" htmlFor={id}>
      <Input
        placeholder="Nummer aus dem bisherigen Programm"
        value={value}
        maxLength={100}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
    </Field>
  );
}
