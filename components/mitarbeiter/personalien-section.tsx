'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  MetadataSection,
  type MetadataField,
} from '@/components/shared/metadata-section';
import {
  updatePersonnelMasterData,
  type PersonnelMasterDataPatch,
} from '@/lib/personnel/actions';
import type { EmployeeRecord } from '@/lib/personnel/types';
import { ErrorText } from '@/components/ui/error-text';

const SAVE_ERROR_MESSAGES: Record<string, string> = {
  number_taken: 'Diese Personalnummer ist in der Organisation bereits vergeben.',
  exit_before_entry: 'Das Austrittsdatum darf nicht vor dem Eintrittsdatum liegen.',
  invalid_date: 'Bitte gib ein gültiges Datum ein.',
  name_managed_by_profile:
    'Der Name wird über das Profil des Mitarbeiters verwaltet.',
  not_authorized: 'Du bist nicht berechtigt, Personaldaten zu ändern.',
  record_not_found: 'Die Personalakte wurde nicht gefunden.',
};

interface PersonalienSectionProps {
  record: EmployeeRecord;
  canEdit: boolean;
}

export function PersonalienSection({ record, canEdit }: PersonalienSectionProps) {
  const router = useRouter();
  const [saveError, setSaveError] = useState<string | null>(null);

  const saveField = (key: keyof PersonnelMasterDataPatch) => {
    return async (newValue: string) => {
      setSaveError(null);
      const result = await updatePersonnelMasterData(record.id, {
        [key]: newValue.trim().length > 0 ? newValue.trim() : null,
      });
      if (!result.success) {
        setSaveError(
          SAVE_ERROR_MESSAGES[result.error ?? ''] ??
            'Die Änderung konnte nicht gespeichert werden.'
        );
        throw new Error(result.error ?? 'update_failed');
      }
      router.refresh();
    };
  };

  const textField = (
    label: string,
    key: keyof PersonnelMasterDataPatch,
    value: string | null,
    options?: { placeholder?: string }
  ): MetadataField => ({
    label,
    value: value || '—',
    editableConfig: canEdit
      ? {
          type: 'text',
          currentValue: value ?? '',
          onSave: saveField(key),
          placeholder: options?.placeholder,
          nullable: true,
        }
      : undefined,
  });

  const dateField = (
    label: string,
    key: keyof PersonnelMasterDataPatch,
    value: string | null
  ): MetadataField => ({
    label,
    value: value
      ? new Date(`${value}T00:00:00`).toLocaleDateString('de-DE', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        })
      : '—',
    editableConfig: canEdit
      ? {
          type: 'date',
          currentValue: value ?? '',
          onSave: saveField(key),
          nullable: true,
        }
      : undefined,
  });

  const fields: MetadataField[] = [
    textField('Personalnummer', 'employeeNumber', record.employeeNumber, {
      placeholder: 'z. B. MA-001',
    }),
  ];

  // For linked records the profile name is authoritative; only records without
  // login carry their own name fields.
  if (!record.userId) {
    fields.push(
      textField('Vorname', 'firstName', record.firstName),
      textField('Nachname', 'lastName', record.lastName)
    );
  }

  fields.push(
    textField('Telefon', 'phone', record.phone),
    textField('Private E-Mail', 'privateEmail', record.privateEmail),
    textField('Straße', 'street', record.street),
    textField('PLZ', 'postalCode', record.postalCode),
    textField('Ort', 'city', record.city),
    textField(
      'Notfallkontakt',
      'emergencyContactName',
      record.emergencyContactName,
      { placeholder: 'Name' }
    ),
    textField(
      'Notfallkontakt Telefon',
      'emergencyContactPhone',
      record.emergencyContactPhone
    ),
    dateField('Eintrittsdatum', 'entryDate', record.entryDate),
    dateField('Austrittsdatum', 'exitDate', record.exitDate),
    {
      label: 'Notizen',
      value: record.notes || '—',
      editableConfig: canEdit
        ? {
            type: 'textarea',
            currentValue: record.notes ?? '',
            onSave: saveField('notes'),
            nullable: true,
          }
        : undefined,
    }
  );

  return (
    <div className="grid gap-2">
      <MetadataSection title="Personalien" fields={fields} isEditable={canEdit} />
      <ErrorText>{saveError}</ErrorText>
    </div>
  );
}
