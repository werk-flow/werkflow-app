'use client';

import { useState, useCallback, useMemo } from 'react';
import { Plus } from 'lucide-react';

import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/searchable-select';
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

export function ClientSelectWithCreate({
  clients,
  value,
  onValueChange,
  disabled,
  readOnly,
  readOnlyLabel,
}: ClientSelectWithCreateProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [localClients, setLocalClients] = useState<Client[]>([]);

  const allClients = useMemo(() => {
    const merged = [...clients];
    for (const lc of localClients) {
      if (!clients.some((c) => c.id === lc.id)) merged.push(lc);
    }
    return merged;
  }, [clients, localClients]);

  const options: SearchableSelectOption[] = useMemo(
    () =>
      allClients.map((c) => ({
        value: c.id,
        label: c.name,
        description: c.email || undefined,
      })),
    [allClients]
  );

  const handleClientCreated = useCallback(
    (client: Client) => {
      setLocalClients((prev) => [...prev, client]);
      onValueChange(client.id);
    },
    [onValueChange]
  );

  return (
    <>
      <SearchableSelect
        options={options}
        value={value}
        onChange={onValueChange}
        placeholder="Kein Kunde"
        searchPlaceholder="Kunde suchen..."
        emptyMessage="Kein Kunde gefunden"
        disabled={disabled}
        allowNone
        noneLabel="Kein Kunde"
        readOnly={readOnly}
        readOnlyLabel={readOnlyLabel}
        action={readOnly ? undefined : {
          label: 'Neuen Kunden erstellen',
          icon: <Plus className="size-4" />,
          onClick: () => setCreateOpen(true),
        }}
      />

      <CreateClientDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onClientCreated={handleClientCreated}
      />
    </>
  );
}
