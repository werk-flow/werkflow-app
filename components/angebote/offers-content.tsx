'use client';

import { FileText, X } from 'lucide-react';
import { useState } from 'react';

import { ListPagination } from '@/components/shared/list-pagination';
import { usePageAction } from '@/components/shared/page-action';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { RefreshButton } from '@/components/ui/refresh-button';
import { SearchInput } from '@/components/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useListNavigation } from '@/hooks/use-list-navigation';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import type { OfferListQuery, OfferPage } from '@/lib/offers/list-page';
import { OFFER_STATUS_LABELS, OFFER_STATUSES, offerStatusSchema } from '@/lib/offers/types';
import { CreateOfferDialog } from './create-offer-dialog';
import { OffersCards, OffersTable } from './offers-list';

const ALL_STATUSES = 'alle';

/**
 * The server selects the page: status, customer, search and count apply in
 * the database before the page boundary, and the URL owns that state. Another
 * session's change reads the page again.
 */
export function OffersContent({ entries, total, hasAnyOffer, query }: OfferPage & { query: OfferListQuery }) {
  // The rows show customer and recipient names, which a customer edit changes.
  useRealtimeRouterRefresh({ tables: ['offers', 'clients'] });
  const navigation = useListNavigation();
  const createDialog = usePageAction();
  // The typed text and the chosen status stay ahead of the URL while the read is under way.
  const [search, setSearch] = useState(query.search);
  const [status, setStatus] = useState(query.status ?? ALL_STATUSES);
  const shownSearch = navigation.busy ? search : query.search;
  const shownStatus = navigation.busy ? status : (query.status ?? ALL_STATUSES);

  return (
    <>
      <div className="mb-4 flex flex-col gap-3">
        <OffersToolbar
          status={shownStatus}
          search={shownSearch}
          onStatusChange={(value) => {
            setSearch(shownSearch);
            setStatus(value);
            const parsed = offerStatusSchema.safeParse(value);
            navigation.navigate({ status: parsed.success ? parsed.data : null, page: 1 });
          }}
          onSearchChange={(value) => {
            setStatus(shownStatus);
            setSearch(value);
            navigation.navigate({ q: value, page: 1 }, 250);
          }}
        />
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>
            {total} {total === 1 ? 'Angebot' : 'Angebote'}
            {query.clientId && ` von ${entries[0]?.clientName ?? 'diesem Kunden'}`}
          </span>
          {query.clientId && (
            <Button size="sm" variant="ghost" onClick={() => navigation.navigate({ kunde: null, page: 1 })}>
              <X className="size-4" />
              Alle Kunden
            </Button>
          )}
        </div>
      </div>
      {entries.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={hasAnyOffer ? 'Keine Angebote gefunden' : 'Noch keine Angebote'}
          description={
            hasAnyOffer
              ? 'Zu der Suche gibt es kein Angebot. Ändere die Suche oder den Status.'
              : 'Lege dein erstes Angebot über „Angebot anlegen“ an.'
          }
        />
      ) : (
        <>
          <OffersCards entries={entries} className="md:hidden" />
          <OffersTable entries={entries} />
        </>
      )}
      <ListPagination
        label="Angebote"
        page={query.page}
        total={total}
        busy={navigation.busy}
        onPageChange={(page) => navigation.navigate({ page })}
      />
      {createDialog.open && <CreateOfferDialog onClose={() => createDialog.setOpen(false)} />}
    </>
  );
}

/** The status filter, the search and the refresh; stacks on phones. */
function OffersToolbar({
  status,
  search,
  onStatusChange,
  onSearchChange,
}: {
  status: string;
  search: string;
  onStatusChange: (status: string) => void;
  onSearchChange: (search: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <Select value={status} onValueChange={onStatusChange}>
        <SelectTrigger className="h-8 w-full sm:w-48" aria-label="Status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_STATUSES}>Alle Status</SelectItem>
          {OFFER_STATUSES.map((value) => (
            <SelectItem key={value} value={value}>
              {OFFER_STATUS_LABELS[value]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex min-w-0 items-center gap-2 sm:flex-1 sm:justify-end">
        <SearchInput
          wrapperClassName="min-w-0 flex-1 sm:max-w-xs"
          value={search}
          onValueChange={onSearchChange}
          className="h-8"
          placeholder="Nummer, Titel, Kunde…"
          aria-label="Angebote durchsuchen"
        />
        <RefreshButton label="Liste aktualisieren" />
      </div>
    </div>
  );
}
