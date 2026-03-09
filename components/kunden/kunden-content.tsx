'use client';

import { useState, useCallback, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ClientsTable } from './clients-table';
import type { Client } from '@/lib/jobs/types';

interface KundenContentProps {
  clients: Client[];
}

export function KundenContent({ clients: initialClients }: KundenContentProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [clients, setClients] = useState<Client[]>(initialClients);
  const [prevCount, setPrevCount] = useState(initialClients.length);

  useEffect(() => {
    setClients(initialClients);
    setPrevCount(initialClients.length);
  }, [initialClients]);

  const handleRefresh = useCallback(() => {
    setPrevCount(clients.length);
    startTransition(() => {
      router.refresh();
    });
  }, [router, clients.length]);

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {clients.length} {clients.length === 1 ? 'Kunde' : 'Kunden'}
        </p>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleRefresh}
          disabled={isPending}
          className="h-8 w-8"
          title="Tabelle aktualisieren"
        >
          <RefreshCw
            className={`size-4 ${isPending ? 'animate-spin' : ''}`}
          />
          <span className="sr-only">Aktualisieren</span>
        </Button>
      </div>

      <ClientsTable
        clients={clients}
        isLoading={isPending}
        skeletonCount={prevCount}
      />
    </>
  );
}
