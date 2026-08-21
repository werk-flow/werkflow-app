'use client';

import { SelectWithCreate } from '@/components/ui/select-with-create';
import type { SearchableSelectOption } from '@/components/ui/searchable-select';
import { CreateClientDialog } from '@/components/kunden/create-client-dialog';
import type { Client } from '@/lib/jobs/types';

interface ClientSelectWithCreateProps {
  clients: Client[];
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
  readOnly?: boolean;
  readOnlyLabel?: string;
}

function clientOption(client: Client): SearchableSelectOption {
  return {
    value: client.id,
    label: client.name,
    description: client.email || undefined,
  };
}

export function ClientSelectWithCreate({
  clients,
  value,
  onValueChange,
  disabled,
  id,
  readOnly,
  readOnlyLabel,
}: ClientSelectWithCreateProps) {
  return (
    <SelectWithCreate
      id={id}
      items={clients}
      getOption={clientOption}
      value={value}
      onValueChange={onValueChange}
      placeholder="Kein Kunde"
      searchPlaceholder="Kunde suchen..."
      emptyMessage="Kein Kunde gefunden"
      disabled={disabled}
      allowNone
      noneLabel="Kein Kunde"
      readOnly={readOnly}
      readOnlyLabel={readOnlyLabel}
      createLabel="Neuen Kunden erstellen"
      renderCreateDialog={({ open, onOpenChange, onCreated }) => (
        <CreateClientDialog
          open={open}
          onOpenChange={onOpenChange}
          onClientCreated={onCreated}
        />
      )}
    />
  );
}
