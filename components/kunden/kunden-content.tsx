'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';

import { useBanner } from '@/components/ui/banner';
import { Input } from '@/components/ui/input';
import { RefreshButton } from '@/components/ui/refresh-button';
import { ClientsTable } from './clients-table';
import { clientCreations } from './create-client-dialog';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useOptimisticChannel } from '@/hooks/use-optimistic-channel';
import { useOptimisticList } from '@/hooks/use-optimistic-list';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import { useSettleOnChange } from '@/hooks/use-settle-on-change';
import { deleteClient } from '@/lib/clients/actions';
import type { Client } from '@/lib/jobs/types';

interface KundenContentProps {
  clients: Client[];
  // Extra searchable text per client id (contact names, site addresses).
  searchIndex?: Record<string, string>;
}

const EMPTY_SEARCH_INDEX: Record<string, string> = {};

const DELETE_ERROR_MESSAGES: Record<string, string> = {
  not_authorized: 'Du bist nicht berechtigt, Kunden zu löschen.',
  client_not_found: 'Der Kunde wurde nicht gefunden.',
};

const getClientId = (client: Client) => client.id;
// The server orders by name; the optimistic row lands where the real one will.
const compareClients = (a: Client, b: Client) => a.name.localeCompare(b.name, 'de');

export function KundenContent({
  clients: initialClients,
  searchIndex = EMPTY_SEARCH_INDEX,
}: KundenContentProps) {
  const router = useRouter();
  const { showBanner } = useBanner();
  // Keep the customer list fresh when colleagues create or edit customers,
  // contacts, or work sites.
  useRealtimeRouterRefresh({
    tables: ['clients', 'client_contacts', 'client_sites'],
  });
  const list = useOptimisticList({
    items: initialClients,
    getId: getClientId,
    compare: compareClients,
  });
  useOptimisticChannel(clientCreations, list);
  const { run: runBusy, isBusy } = useBusyIds();
  const waitForChange = useSettleOnChange(initialClients);
  const [search, setSearch] = useState('');

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return list.items;
    return list.items.filter(({ item: client }) => {
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
  }, [list.items, search, searchIndex]);

  // Edit from a dialog: the row stays marked until the refreshed props land.
  const handleClientSaved = useCallback(
    (clientId: string) => {
      void runBusy(clientId, waitForChange);
    },
    [runBusy, waitForChange]
  );

  // Delete: the row leaves at once and comes back with the error on failure.
  const { remove, rollback } = list;
  const handleDeleteClient = useCallback(
    async (client: Client) => {
      remove(client.id);
      const result = await deleteClient(client.id).catch(() => null);
      if (!result || !result.success) {
        rollback(client.id);
        showBanner({
          variant: 'error',
          message: `Kunde „${client.name}" konnte nicht gelöscht werden: ${
            (result && DELETE_ERROR_MESSAGES[result.error]) ??
            'Bitte versuche es erneut.'
          }`,
        });
        return;
      }
      showBanner({
        variant: 'success',
        message: `Kunde „${client.name}" wurde gelöscht.`,
      });
      router.refresh();
    },
    [remove, rollback, router, showBanner]
  );

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="shrink-0 text-sm text-muted-foreground">
          {filteredRows.length}{' '}
          {filteredRows.length === 1 ? 'Kunde' : 'Kunden'}
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
          <RefreshButton label="Tabelle aktualisieren" />
        </div>
      </div>

      <ClientsTable
        rows={filteredRows}
        isBusy={isBusy}
        onSaved={handleClientSaved}
        onDelete={handleDeleteClient}
      />
    </>
  );
}
