'use client';

import { useState, useCallback, useEffect, useMemo, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ClientsTable } from './clients-table';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import type { Client } from '@/lib/jobs/types';

interface KundenContentProps {
  clients: Client[];
  // Extra searchable text per client id (contact names, site addresses).
  searchIndex?: Record<string, string>;
}

const EMPTY_SEARCH_INDEX: Record<string, string> = {};

export function KundenContent({
  clients: initialClients,
  searchIndex = EMPTY_SEARCH_INDEX,
}: KundenContentProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Keep the customer list fresh when colleagues create or edit customers,
  // contacts, or work sites.
  useRealtimeRouterRefresh({
    tables: ['clients', 'client_contacts', 'client_sites'],
  });
  const [clients, setClients] = useState<Client[]>(initialClients);
  const [prevCount, setPrevCount] = useState(initialClients.length);
  const [search, setSearch] = useState('');

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

  const filteredClients = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return clients;
    return clients.filter((client) => {
      const haystack = [
        client.name,
        client.customerNumber,
        client.email,
        client.phone,
        client.address,
        searchIndex[client.id],
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [clients, search, searchIndex]);

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="shrink-0 text-sm text-muted-foreground">
          {filteredClients.length}{' '}
          {filteredClients.length === 1 ? 'Kunde' : 'Kunden'}
        </p>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-9"
              placeholder="Kunde, Ansprechpartner, Einsatzort..."
              aria-label="Kunden durchsuchen"
            />
          </div>
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
      </div>

      <ClientsTable
        clients={filteredClients}
        isLoading={isPending}
        skeletonCount={prevCount}
      />
    </>
  );
}
