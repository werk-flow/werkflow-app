'use client';

import { useJobEntityOptions } from '@/hooks/use-job-entity-options';
import { SelectWithCreate } from '@/components/ui/select-with-create';
import type { SearchableSelectOption } from '@/components/ui/searchable-select';
import { CreateClientDialog } from '@/components/kunden/create-client-dialog';
import type { Client } from '@/lib/jobs/types';

/**
 * The select only needs identity and display fields, so callers that hold a
 * projected client option (service, maintenance) can use it without
 * fabricating a full `Client`. A created `Client` satisfies it as well.
 */
type ClientSelectItem = Pick<Client, 'id' | 'name'> &
  Partial<Pick<Client, 'email'>>;

interface ClientSelectWithCreateProps {
  clients: ClientSelectItem[];
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  id?: string | undefined;
  readOnly?: boolean | undefined;
  readOnlyLabel?: string | undefined;
}

function clientOption(client: ClientSelectItem): SearchableSelectOption {
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
  const search = useJobEntityOptions({ kind: 'clients' }, value ? [value] : [], clients.map(clientOption));
  return (
    <SelectWithCreate
      id={id}
      items={search.options}
      getOption={(option) => option}
      onSearchChange={search.onSearchChange} loading={search.loading} loadError={search.loadError} onLoadMore={search.onLoadMore}
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
          onClientCreated={(client) => onCreated(clientOption(client))}
        />
      )}
    />
  );
}
