'use client';

import { useState, useCallback } from 'react';
import { Plus } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CreateClientDialog } from '@/components/kunden/create-client-dialog';
import type { Client } from '@/lib/jobs/types';

interface ClientSelectWithCreateProps {
  clients: Client[];
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
}

export function ClientSelectWithCreate({
  clients,
  value,
  onValueChange,
  disabled,
  id,
}: ClientSelectWithCreateProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [localClients, setLocalClients] = useState<Client[]>([]);

  const allClients = [...clients, ...localClients.filter(
    (lc) => !clients.some((c) => c.id === lc.id)
  )];

  const handleClientCreated = useCallback((client: Client) => {
    setLocalClients((prev) => [...prev, client]);
    onValueChange(client.id);
  }, [onValueChange]);

  return (
    <>
      <Select
        value={value || 'none'}
        onValueChange={(v) => {
          if (v === '__create__') {
            setCreateOpen(true);
            return;
          }
          onValueChange(v === 'none' ? '' : v);
        }}
        disabled={disabled}
      >
        <SelectTrigger id={id}>
          <SelectValue placeholder="Kein Kunde" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Kein Kunde</SelectItem>
          <SelectItem value="__create__" className="text-primary font-medium">
            <span className="flex items-center gap-1.5">
              <Plus className="size-3.5" />
              Neuen Kunden erstellen
            </span>
          </SelectItem>
          {allClients.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <CreateClientDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onClientCreated={handleClientCreated}
      />
    </>
  );
}
