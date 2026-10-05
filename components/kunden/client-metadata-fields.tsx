'use client';

import { Badge } from '@/components/ui/badge';
import { MetadataSaveError, type MetadataField } from '@/components/shared/metadata-section';
import { describeFailure } from '@/lib/action-messages';
import { updateClient, type UpdateClientInput } from '@/lib/clients/actions';
import { CLIENT_TYPE_LABELS, type Client, type ClientType } from '@/lib/jobs/types';
import { formatGermanDate } from '@/lib/utils';

const CLIENT_SAVE_ERROR_MESSAGES: Record<string, string> = {
  not_authorized: 'Du bist nicht berechtigt, Kunden zu bearbeiten.',
  name_required: 'Bitte gib einen Namen ein.',
  client_not_found: 'Der Kunde wurde nicht gefunden.',
  customer_number_taken: 'Diese Kundennummer ist bereits vergeben.',
};

/** The editable master-data rows of the customer detail page. */
export function buildClientMetadataFields(client: Client): MetadataField[] {
  const clientTypeOptions: { value: string; label: string }[] = [
    { value: 'privat', label: CLIENT_TYPE_LABELS.privat },
    { value: 'gewerblich', label: CLIENT_TYPE_LABELS.gewerblich },
  ];

  // A rejected save must surface in the field (MetadataSection catches the
  // throw); a discarded result would close the editor over unsaved data.
  const saveClientField = async (input: UpdateClientInput): Promise<void> => {
    const result = await updateClient(client.id, input);
    if (!result.success) {
      throw new MetadataSaveError(
        describeFailure(
          result.error,
          CLIENT_SAVE_ERROR_MESSAGES,
          'Die Änderung konnte nicht gespeichert werden.',
        ),
      );
    }
  };

  const metadataFields: MetadataField[] = [
    {
      label: 'Name',
      value: client.name,
      editableConfig: {
        type: 'text',
        currentValue: client.name,
        onSave: (v) => saveClientField({ name: v }),
      },
    },
    {
      label: 'Typ',
      value: (
        <Badge variant="secondary" className="text-xs">
          {CLIENT_TYPE_LABELS[client.clientType]}
        </Badge>
      ),
      editableConfig: {
        type: 'select',
        currentValue: client.clientType,
        onSave: (v) => saveClientField({ clientType: v as ClientType }),
        options: clientTypeOptions,
      },
    },
    {
      label: 'Kundennummer',
      value: client.customerNumber || '—',
      editableConfig: {
        type: 'text',
        currentValue: client.customerNumber ?? '',
        onSave: (v) => saveClientField({ customerNumber: v }),
        placeholder: 'z. B. K-1001',
      },
    },
    {
      label: 'E-Mail',
      value: client.email || '—',
      editableConfig: {
        type: 'text',
        currentValue: client.email ?? '',
        onSave: (v) => saveClientField({ email: v }),
        placeholder: 'E-Mail-Adresse',
      },
    },
    {
      label: 'Telefon',
      value: client.phone || '—',
      editableConfig: {
        type: 'text',
        currentValue: client.phone ?? '',
        onSave: (v) => saveClientField({ phone: v }),
        placeholder: 'Telefonnummer',
      },
    },
    {
      label: 'Adresse',
      value: client.address || '—',
      editableConfig: {
        type: 'textarea',
        currentValue: client.address ?? '',
        onSave: (v) => saveClientField({ address: v }),
        placeholder: 'Straße, PLZ, Ort',
      },
    },
    {
      label: 'Notizen',
      value: client.notes || '—',
      editableConfig: {
        type: 'textarea',
        currentValue: client.notes ?? '',
        onSave: (v) => saveClientField({ notes: v }),
        placeholder: 'Interne Notizen',
      },
    },
    {
      label: 'Erstellt am',
      value: formatGermanDate(client.createdAt),
    },
  ];

  return metadataFields;
}
