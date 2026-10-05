'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

import { useBanner } from '@/components/ui/banner';
import { SearchInput } from '@/components/ui/search-input';
import { RefreshButton } from '@/components/ui/refresh-button';
import { ListPagination } from '@/components/shared/list-pagination';
import { useListNavigation } from '@/hooks/use-list-navigation';
import { ClientsTable } from './clients-table';
import { clientCreations } from './create-client-dialog';
import { CLIENT_DELETE_ERROR_MESSAGES } from './use-client-deletion';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useOptimisticChannel } from '@/hooks/use-optimistic-channel';
import { useOptimisticList } from '@/hooks/use-optimistic-list';
import { useLiveView } from '@/hooks/use-live-view';
import { fetchCustomerPage } from '@/lib/clients/list-page';
import { UsableContent } from '@/components/shared/usable-content';
import { describeFailure } from '@/lib/action-messages';
import { deleteClient } from '@/lib/clients/actions';
import type { Client } from '@/lib/jobs/types';

interface KundenContentProps {
  organizationId: string;
  /** Organization, caller and role identity of the rendered scope. */
  scopeKey: string;
  clients: Client[];
  page: number;
  total: number;
  searchQuery: string;
}

type SearchControl = {
  value: string;
  onChange: (value: string) => void;
  /** Whether the search input owned focus before the list remounted. */
  focusedRef: RefObject<boolean>;
};

const getClientId = (client: Client) => client.id;
// The server orders by name; the optimistic row lands where the real one will.
const compareClients = (a: Client, b: Client) => a.name.localeCompare(b.name, 'de');

/**
 * Search text, the pending URL navigation and the input's focus outlive the
 * keyed list below. Each committed page or search remounts the list so live
 * and optimistic state cannot cross scopes; a remount must not drop a
 * keystroke typed during the round trip or the 250 ms navigation timer.
 */
export function KundenContent(props: KundenContentProps) {
  const { scopeKey, page, searchQuery } = props;
  const navigation = useListNavigation();
  const [search, setSearch] = useState(searchQuery);
  const focusedRef = useRef(false);
  const onChange = (value: string) => {
    setSearch(value);
    navigation.navigate({ q: value, page: 1 }, 250);
  };
  return (
    <KundenList
      key={`${scopeKey}:${page}:${searchQuery}`}
      {...props}
      navigation={navigation}
      search={{ value: navigation.busy ? search : searchQuery, onChange, focusedRef }}
    />
  );
}

function KundenList({
  organizationId,
  clients: initialClients,
  page,
  total: initialTotal,
  searchQuery,
  navigation,
  search,
}: KundenContentProps & { navigation: ReturnType<typeof useListNavigation>; search: SearchControl }) {
  const { showBanner } = useBanner();
  const confirmedCreations = useRef(new Set<string>());
  const live = useLiveView({
    tables: ['clients', 'client_contacts', 'client_sites'],
    coalesceWhileReading: true,
    initialData: { clients: initialClients, total: initialTotal, settledCreations: [] as string[] },
    read: async ({ signal }) => {
      const settledCreations = [...confirmedCreations.current];
      const data = await fetchCustomerPage({ organizationId, page, search: searchQuery }, signal);
      return { ok: true, data: { ...data, settledCreations } };
    },
  });
  // A same-page Server Action refresh is another invalidation. Read current
  // data instead of letting a late route snapshot overwrite a newer live read.
  const previousSnapshot = useRef(initialClients);
  const { refresh } = live;
  useEffect(() => {
    if (previousSnapshot.current === initialClients) return;
    previousSnapshot.current = initialClients;
    void refresh();
  }, [initialClients, refresh]);
  const clients = live.data?.clients ?? initialClients;
  const total = live.data?.total ?? initialTotal;
  const list = useOptimisticList({
    items: clients,
    getId: getClientId,
    compare: compareClients,
  });
  const { insert, commit, rollback } = list;
  const { invalidate } = live;
  const insertCreation = useCallback(
    (tempId: string, draft: Client) => {
      invalidate();
      insert(tempId, draft);
    },
    [invalidate, insert],
  );
  const commitCreation = useCallback(
    (tempId: string, client: Client) => {
      // A create started before an organization switch can finish afterward.
      if (client.organizationId !== organizationId) {
        rollback(tempId);
        return;
      }
      confirmedCreations.current.add(client.id);
      commit(tempId, client);
      void refresh();
    },
    [commit, refresh, organizationId, rollback],
  );
  const rollbackCreation = useCallback(
    (tempId: string) => {
      rollback(tempId);
      void refresh();
    },
    [rollback, refresh],
  );
  useOptimisticChannel(clientCreations, {
    insert: insertCreation,
    commit: commitCreation,
    rollback: rollbackCreation,
  });
  // Only a successfully committed read started after the save can settle an
  // insertion outside this page/search. Failed or superseded reads cannot.
  useEffect(() => {
    for (const id of live.data?.settledCreations ?? []) {
      confirmedCreations.current.delete(id);
      rollback(id);
    }
  }, [live.data, rollback]);
  const { run: runBusy, isBusy } = useBusyIds();
  const filteredRows = list.items;
  // The previous list instance's input had focus; keep the caret where the
  // user is typing before the browser paints the remounted input.
  const searchInput = useRef<HTMLInputElement>(null);
  const { focusedRef } = search;
  useLayoutEffect(() => {
    const input = searchInput.current;
    if (!focusedRef.current || !input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, [focusedRef]);
  // Keep the edited row marked until its authoritative read finishes.
  const handleClientSaved = useCallback(
    (clientId: string) => {
      void runBusy(clientId, refresh);
    },
    [runBusy, refresh],
  );

  // Delete: the row leaves at once and comes back with the error on failure.
  const { remove } = list;
  const handleDeleteClient = useCallback(
    async (client: Client) => {
      invalidate();
      remove(client.id);
      const result = await deleteClient(client.id).catch(() => null);
      if (!result || !result.success) {
        rollback(client.id);
        const retryHint = 'Bitte versuche es erneut.';
        const reason = result
          ? describeFailure(result.error, CLIENT_DELETE_ERROR_MESSAGES, retryHint)
          : retryHint;
        showBanner({
          variant: 'error',
          message: `Kunde „${client.name}“ konnte nicht gelöscht werden: ${reason}`,
        });
        await refresh();
        return;
      }
      showBanner({
        variant: 'success',
        message: `Kunde „${client.name}“ wurde gelöscht.`,
      });
      await refresh();
    },
    [remove, rollback, refresh, invalidate, showBanner],
  );

  return (
    <UsableContent name="kunden" count={filteredRows.length}>
      {live.isStale && (
        <p role="status" className="mb-3 text-sm text-muted-foreground">
          Die Kundenliste konnte nicht aktualisiert werden. Bitte versuche es erneut.
        </p>
      )}
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="shrink-0 text-sm text-muted-foreground">
          {total} {total === 1 ? 'Kunde' : 'Kunden'}
        </p>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          <SearchInput
            ref={searchInput}
            wrapperClassName="w-full max-w-xs"
            value={search.value}
            onValueChange={search.onChange}
            onFocus={() => {
              focusedRef.current = true;
            }}
            onBlur={() => {
              focusedRef.current = false;
            }}
            className="h-8"
            placeholder="Kunde, Ansprechpartner, Einsatzort…"
            aria-label="Kunden durchsuchen"
          />
          <RefreshButton label="Tabelle aktualisieren" onRefresh={refresh} />
        </div>
      </div>

      <div inert={live.isStale || undefined}>
        <ClientsTable
          rows={filteredRows}
          isBusy={isBusy}
          onSaved={handleClientSaved}
          onDelete={handleDeleteClient}
          isFiltered={searchQuery.trim() !== ''}
        />
      </div>
      <ListPagination
        label="Kunden"
        page={page}
        total={total}
        busy={navigation.busy}
        onPageChange={(nextPage) => navigation.navigate({ page: nextPage })}
      />
    </UsableContent>
  );
}
