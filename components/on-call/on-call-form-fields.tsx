'use client';

import type { ReactElement } from 'react';

import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SearchableMultiSelect } from '@/components/ui/searchable-select';
import { Textarea } from '@/components/ui/textarea';
import type { OnCallPerson } from '@/lib/on-call/types';

// The fields the plan, change and handover dialogs share.

export function OnCallPeopleField({
  id,
  people,
  selectedIds,
  onChange,
  error,
}: {
  id: string;
  people: readonly OnCallPerson[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  error: string | undefined;
}): ReactElement {
  // A person who left stays selectable only while the shift already names them.
  const options = people
    .filter((person) => person.active || selectedIds.includes(person.employeeRecordId))
    .map((person) => ({
      value: person.employeeRecordId,
      label: person.name,
      description: person.phone ?? 'Keine Telefonnummer hinterlegt',
    }));
  return (
    <Field label="Wer hat Bereitschaft?" htmlFor={id} required error={error}>
      <SearchableMultiSelect
        options={options}
        selectedIds={selectedIds}
        onSelectionChange={onChange}
        placeholder="Personen wählen"
        searchPlaceholder="Person suchen…"
        emptyMessage="Keine Person gefunden"
        selectedLabel={(count) => (count === 1 ? '1 Person' : `${count} Personen`)}
      />
    </Field>
  );
}

export function OnCallLabelField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (label: string) => void;
}): ReactElement {
  return (
    <Field
      label="Bereich"
      htmlFor={id}
      description="Optional, zum Beispiel „Heizung“, wenn ihr pro Gewerk Bereitschaft habt."
    >
      <Input value={value} onChange={(event) => onChange(event.target.value)} maxLength={60} />
    </Field>
  );
}

export function OnCallNoteField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (note: string) => void;
}): ReactElement {
  return (
    <Field label="Übergabenotiz" htmlFor={id} description="Was die Bereitschaft wissen muss.">
      <Textarea value={value} onChange={(event) => onChange(event.target.value)} maxLength={2000} />
    </Field>
  );
}

/** The question a save gets when another shift with the same label covers the same time. */
export function OverlapNotice({ label }: { label: string }): ReactElement {
  const area = label.trim() ? ` „${label.trim()}“` : '';
  return (
    <p role="status" className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-soft-foreground">
      Zur selben Zeit hat schon jemand Bereitschaft{area}. Speichere noch einmal, wenn beide gelten sollen.
    </p>
  );
}
