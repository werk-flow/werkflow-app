'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

import { useBanner } from '@/components/ui/banner';
import { SearchInput } from '@/components/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RefreshButton } from '@/components/ui/refresh-button';
import { ListPagination } from '@/components/shared/list-pagination';
import { useListNavigation } from '@/hooks/use-list-navigation';
import { ClientsTable } from './clients-table';
import { clientCreations } from './create-client-dialog';
import type { ClientRowActions } from './client-actions-menu';
import { CLIENT_REMOVAL_ERROR_MESSAGES, type ClientRemoval } from './client-removal-dialog';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useOptimisticChannel } from '@/hooks/use-optimistic-channel';
import { useOptimisticList } from '@/hooks/use-optimistic-list';
import { useLiveView, type LiveViewState } from '@/hooks/use-live-view';
import { customerListViewSchema, fetchCustomerPage, type CustomerListView } from '@/lib/clients/list-page';
import { UsableContent } from '@/components/shared/usable-content';
import { describeFailure } from '@/lib/action-messages';
import { restoreClient } from '@/lib/clients/actions';
import type { Client } from '@/lib/jobs/types';

interface KundenContentProps {
  organizationId: string;
  /** Organization, caller and role identity of the rendered scope. */
  scopeKey: string;
  clients: Client[];
  page: number;
  total: number;
  searchQuery: string;
  /** Active customers, or only the archived ones. */
  view: CustomerListView;
}

type ViewControl = { value: CustomerListView; onChange: (value: CustomerListView) => void };

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
  const { scopeKey, page, searchQuery, view } = props;
  const navigation = useListNavigation();
  const [search, setSearch] = useState(searchQuery);
  const [shownView, setShownView] = useState(view);
  const focusedRef = useRef(false);
  const onChange = (value: string) => {
    setShownView(navigation.busy ? shownView : view);
    setSearch(value);
    navigation.navigate({ q: value, page: 1 }, 250);
  };
  const onViewChange = (value: CustomerListView) => {
    setSearch(navigation.busy ? search : searchQuery);
    setShownView(value);
    navigation.navigate({ ansicht: value === 'aktiv' ? null : value, page: 1 });
  };
  return (
    <KundenList
      key={`${scopeKey}:${view}:${page}:${searchQuery}`}
      {...props}
      navigation={navigation}
      search={{ value: navigation.busy ? search : searchQuery, onChange, focusedRef }}
      viewControl={{ value: navigation.busy ? shownView : view, onChange: onViewChange }}
    />
  );
}

type KundenListProps = KundenContentProps & {
  navigation: ReturnType<typeof useListNavigation>;
  search: SearchControl;
  viewControl: ViewControl;
};

/** The live page read plus the creations a read started after their save has settled. */
type KundenLivePage = { clients: Client[]; total: number; settledCreations: string[] };

/** The live page read, refreshed by a same-page route snapshot. */
function useKundenLivePage({
  organizationId,
  clients: initialClients,
  page,
  total: initialTotal,
  searchQuery,
  view,
}: KundenContentProps) {
  const confirmedCreations = useRef(new Set<string>());
  const live = useLiveView<KundenLivePage>({
    tables: ['clients', 'client_contacts', 'client_sites'],
    coalesceWhileReading: true,
    initialData: { clients: initialClients, total: initialTotal, settledCreations: [] },
    read: async ({ signal }) => {
      const settledCreations = [...confirmedCreations.current];
      const data = await fetchCustomerPage({ organizationId, page, search: searchQuery, view }, signal);
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
  return { live, confirmedCreations };
}

/** The optimistic list with the creations the header dialog publishes. */
function useKundenOptimisticClients(
  organizationId: string,
  /** A new customer is active: the archived view never shows it. */
  showsCreations: boolean,
  clients: Client[],
  live: LiveViewState<KundenLivePage>,
  confirmedCreations: RefObject<Set<string>>,
) {
  const { refresh } = live;
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
      if (showsCreations) insert(tempId, draft);
    },
    [invalidate, insert, showsCreations],
  );
  const commitCreation = useCallback(
    (tempId: string, client: Client) => {
      // A create started before an organization switch can finish afterward.
      if (client.organizationId !== organizationId) {
        rollback(tempId);
        return;
      }
      // The archived view never inserted the new, active customer.
      if (!showsCreations) {
        void refresh();
        return;
      }
      confirmedCreations.current.add(client.id);
      commit(tempId, client);
      void refresh();
    },
    [commit, refresh, organizationId, rollback, confirmedCreations, showsCreations],
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
  }, [live.data, rollback, confirmedCreations]);
  return list;
}

/** The previous list instance's input had focus; keep the caret where the user is typing. */
function useRestoredSearchFocus(focusedRef: RefObject<boolean>) {
  // Runs before the browser paints the remounted input.
  const searchInput = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    const input = searchInput.current;
    if (!focusedRef.current || !input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, [focusedRef]);
  return searchInput;
}

const REMOVAL_DONE: Record<ClientRemoval, string> = { archive: 'archiviert', delete: 'gelöscht' };

/**
 * The row actions of the list: an archived or deleted customer leaves the
 * list once the dialog's save is confirmed; a restored one leaves the
 * archived view at once and comes back with the error on failure.
 */
function useKundenRowActions(
  list: ReturnType<typeof useOptimisticList<Client>>,
  view: CustomerListView,
  live: Pick<LiveViewState<KundenLivePage>, 'invalidate' | 'refresh'>,
  onSaved: (clientId: string) => void,
  showBanner: ReturnType<typeof useBanner>['showBanner'],
): ClientRowActions {
  const { remove, rollback } = list;
  const { invalidate, refresh } = live;
  const onRemoved = useCallback(
    async (client: Client, removal: ClientRemoval) => {
      invalidate();
      remove(client.id);
      showBanner({ variant: 'success', message: `Kunde „${client.name}“ wurde ${REMOVAL_DONE[removal]}.` });
      await refresh();
    },
    [invalidate, remove, refresh, showBanner],
  );
  const onRestore = useCallback(
    async (client: Client) => {
      invalidate();
      remove(client.id);
      const result = await restoreClient(client.id).catch(() => null);
      if (!result?.success) {
        rollback(client.id);
        const retryHint = 'Bitte versuche es erneut.';
        const reason = result
          ? describeFailure(result.error, CLIENT_REMOVAL_ERROR_MESSAGES, retryHint)
          : retryHint;
        showBanner({
          variant: 'error',
          message: `Kunde „${client.name}“ konnte nicht wiederhergestellt werden: ${reason}`,
        });
      } else {
        showBanner({ variant: 'success', message: `Kunde „${client.name}“ wurde wiederhergestellt.` });
      }
      await refresh();
    },
    [invalidate, remove, rollback, refresh, showBanner],
  );
  return { isArchivedView: view === 'archiviert', onSaved, onRemoved, onRestore };
}

/** The count, the search that keeps its focus across remounts, and the refresh. */
function KundenListToolbar({
  total,
  search,
  searchInput,
  viewControl,
  onRefresh,
}: {
  total: number;
  search: SearchControl;
  searchInput: RefObject<HTMLInputElement | null>;
  viewControl: ViewControl;
  onRefresh: () => Promise<void>;
}) {
  const { focusedRef } = search;
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <Select
          value={viewControl.value}
          onValueChange={(value) => {
            const parsed = customerListViewSchema.safeParse(value);
            if (parsed.success) viewControl.onChange(parsed.data);
          }}
        >
          <SelectTrigger className="h-8 w-44" aria-label="Kunden anzeigen">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="aktiv">Aktive Kunden</SelectItem>
            <SelectItem value="archiviert">Archivierte</SelectItem>
          </SelectContent>
        </Select>
        <p className="shrink-0 text-sm text-muted-foreground">
          {total} {total === 1 ? 'Kunde' : 'Kunden'}
        </p>
      </div>
      <div className="flex min-w-0 flex-1 basis-full items-center justify-end gap-2 sm:basis-auto">
        <SearchInput
          ref={searchInput}
          wrapperClassName="w-full sm:max-w-xs"
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
        <RefreshButton label="Tabelle aktualisieren" onRefresh={onRefresh} />
      </div>
    </div>
  );
}

function KundenList(props: KundenListProps) {
  const { organizationId, clients: initialClients, page, total: initialTotal, searchQuery, view } = props;
  const { navigation, search, viewControl } = props;
  const { showBanner } = useBanner();
  const { live, confirmedCreations } = useKundenLivePage(props);
  const { refresh } = live;
  const clients = live.data?.clients ?? initialClients;
  const total = live.data?.total ?? initialTotal;
  const list = useKundenOptimisticClients(
    organizationId,
    view === 'aktiv',
    clients,
    live,
    confirmedCreations,
  );
  const { run: runBusy, isBusy } = useBusyIds();
  const filteredRows = list.items;
  const searchInput = useRestoredSearchFocus(search.focusedRef);
  // Keep the edited row marked until its authoritative read finishes.
  const handleClientSaved = useCallback(
    (clientId: string) => {
      void runBusy(clientId, refresh);
    },
    [runBusy, refresh],
  );
  const rowActions = useKundenRowActions(list, view, live, handleClientSaved, showBanner);

  return (
    <UsableContent name="kunden" count={filteredRows.length}>
      {live.isStale && (
        <p role="status" className="mb-3 text-sm text-muted-foreground">
          Die Kundenliste konnte nicht aktualisiert werden. Bitte versuche es erneut.
        </p>
      )}
      <KundenListToolbar
        total={total}
        search={search}
        searchInput={searchInput}
        viewControl={viewControl}
        onRefresh={refresh}
      />

      <div inert={live.isStale || undefined}>
        <ClientsTable
          rows={filteredRows}
          isBusy={isBusy}
          actions={rowActions}
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
