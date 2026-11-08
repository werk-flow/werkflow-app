'use client';

import { useId } from 'react';

import { DatePicker } from '@/components/ui/date-picker';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toLocalDateString } from '@/lib/utils';
import type { WorkArtifactFieldState } from './use-work-artifact-editor';
import type { WorkArtifactContentDraft } from './work-artifact-content';

export type WorkArtifactContentFieldsProps = {
  content: WorkArtifactContentDraft;
  patchContent: (patch: Partial<WorkArtifactContentDraft>) => void;
  /** A rule field's control id, required mark and error. */
  fieldState: WorkArtifactFieldState;
};

// Thin composites over the registry `Field`: the artifact form has ~40 free-text
// slots that differ only in label and target key.
export function TextField({
  id: providedId,
  label,
  value,
  onChange,
  textarea = false,
  required = false,
  error,
}: {
  id?: string;
  label: string;
  value?: string | undefined;
  onChange: (value: string) => void;
  textarea?: boolean;
  required?: boolean;
  error?: string | null | undefined;
}) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  return (
    <Field label={label} htmlFor={id} required={required} error={error}>
      {textarea ? (
        <Textarea value={value ?? ''} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <Input value={value ?? ''} onChange={(event) => onChange(event.target.value)} />
      )}
    </Field>
  );
}

export function DateField({
  id,
  label,
  value,
  onChange,
  required = false,
  error,
}: {
  id: string;
  label: string;
  value?: string | undefined;
  onChange: (value: string) => void;
  required?: boolean;
  error?: string | undefined;
}) {
  const date = value
    ? new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)))
    : undefined;
  return (
    <Field label={label} htmlFor={id} required={required} error={error}>
      <DatePicker
        value={date}
        onChange={(next) => onChange(next ? toLocalDateString(next) : '')}
        ariaLabel={label}
      />
    </Field>
  );
}
