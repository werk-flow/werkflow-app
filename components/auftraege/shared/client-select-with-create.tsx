'use client';

import { useRef } from 'react';

import { useJobEntityOptions } from '@/hooks/use-job-entity-options';
import { SelectWithCreate } from '@/components/ui/select-with-create';
import type { SearchableSelectOption } from '@/components/ui/searchable-select';
import { CreateClientDialog } from '@/components/kunden/create-client-dialog';
import type { Client } from '@/lib/jobs/types';

/** A customer the page already knows: identity and display fields only. */
export type ClientSelectItem = Pick<Client, 'id' | 'name'> & Partial<Pick<Client, 'email'>>;

interface ClientSelectWithCreateProps {
  /** The selected customer's name the page already holds, shown until the server answers. */
  selectedClient?: ClientSelectItem | null | undefined;
  value: string;
  /** Hands back the chosen customer's label with its id; `null` for „Kein Kunde“. */
  onValueChange: (value: string, client: ClientSelectItem | null) => void;
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

/**
 * The customer picker. It searches every customer of the organization on the
 * server one page at a time and never takes a preloaded list.
 */
export function ClientSelectWithCreate({
  selectedClient,
  value,
  onValueChange,
  disabled,
  id,
  readOnly,
  readOnlyLabel,
}: ClientSelectWithCreateProps) {
  const search = useJobEntityOptions(
    { kind: 'clients' },
    value ? [value] : [],
    selectedClient && selectedClient.id === value ? [clientOption(selectedClient)] : undefined,
  );
  // A customer created in the dialog is chosen before any search returns it.
  const createdRef = useRef<SearchableSelectOption | null>(null);

  const handleValueChange = (nextValue: string) => {
    const option =
      search.options.find((entry) => entry.value === nextValue) ??
      (createdRef.current?.value === nextValue ? createdRef.current : undefined);
    onValueChange(nextValue, option ? { id: option.value, name: option.label } : null);
  };

  return (
    <SelectWithCreate
      id={id}
      items={search.options}
      getOption={(option) => option}
      onSearchChange={search.onSearchChange}
      loading={search.loading}
      loadError={search.loadError}
      onRetryLoad={search.onRetryLoad}
      onLoadMore={search.onLoadMore}
      value={value}
      onValueChange={handleValueChange}
      placeholder="Kein Kunde"
      searchPlaceholder="Kunde suchen…"
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
          onClientCreated={(client) => {
            createdRef.current = clientOption(client);
            onCreated(createdRef.current);
          }}
        />
      )}
    />
  );
}
