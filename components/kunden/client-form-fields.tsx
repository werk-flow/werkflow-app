'use client';

import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CLIENT_TYPE_LABELS, type ClientType } from '@/lib/jobs/types';

const CLIENT_TYPE_OPTIONS: { value: ClientType; label: string }[] = [
  { value: 'privat', label: CLIENT_TYPE_LABELS.privat },
  { value: 'gewerblich', label: CLIENT_TYPE_LABELS.gewerblich },
];

/** Narrows a client-type Select value to the types the form offers. */
function isClientType(value: string): value is ClientType {
  return Object.hasOwn(CLIENT_TYPE_LABELS, value);
}

export interface ClientFormValues {
  name: string;
  clientType: ClientType;
  email: string;
  phone: string;
  address: string;
  notes: string;
}

interface ClientFormFieldsProps {
  /** Prefix of every field id: `client` in the create dialog, `edit-client` in the edit dialog. */
  idPrefix: string;
  values: ClientFormValues;
  nameError: string | undefined;
  disabled: boolean;
  onNameChange: (name: string) => void;
  onClientTypeChange: (clientType: ClientType) => void;
  onEmailChange: (email: string) => void;
  onPhoneChange: (phone: string) => void;
  onAddressChange: (address: string) => void;
  onNotesChange: (notes: string) => void;
}

/** The master-data fields the create and edit customer dialogs share. */
export function ClientFormFields({
  idPrefix,
  values,
  nameError,
  disabled,
  onNameChange,
  onClientTypeChange,
  onEmailChange,
  onPhoneChange,
  onAddressChange,
  onNotesChange,
}: ClientFormFieldsProps) {
  return (
    <>
      <Field label="Name" htmlFor={`${idPrefix}-name`} required error={nameError}>
        <Input
          placeholder="Kundenname"
          value={values.name}
          onChange={(e) => onNameChange(e.target.value)}
          disabled={disabled}
        />
      </Field>
      <Field label="Typ" htmlFor={`${idPrefix}-type`}>
        <Select
          value={values.clientType}
          onValueChange={(value) => {
            if (isClientType(value)) onClientTypeChange(value);
          }}
          disabled={disabled}
        >
          <SelectTrigger>
            <SelectValue placeholder="Typ auswählen" />
          </SelectTrigger>
          <SelectContent>
            {CLIENT_TYPE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="E-Mail" htmlFor={`${idPrefix}-email`}>
        <Input
          type="text"
          inputMode="email"
          placeholder="kunde@beispiel.de"
          value={values.email}
          onChange={(e) => onEmailChange(e.target.value)}
          disabled={disabled}
        />
      </Field>
      <Field label="Telefon" htmlFor={`${idPrefix}-phone`}>
        <Input
          type="tel"
          placeholder="+49 123 456789"
          value={values.phone}
          onChange={(e) => onPhoneChange(e.target.value)}
          disabled={disabled}
        />
      </Field>
      <Field label="Adresse" htmlFor={`${idPrefix}-address`}>
        <Input
          placeholder="Straße, PLZ Ort"
          value={values.address}
          onChange={(e) => onAddressChange(e.target.value)}
          disabled={disabled}
        />
      </Field>
      <Field label="Notizen" htmlFor={`${idPrefix}-notes`}>
        <Textarea
          placeholder="Optionale Notizen zum Kunden…"
          value={values.notes}
          onChange={(e) => onNotesChange(e.target.value)}
          disabled={disabled}
        />
      </Field>
    </>
  );
}
