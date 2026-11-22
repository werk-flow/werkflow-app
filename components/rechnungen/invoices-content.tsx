'use client';

import { ReceiptText } from 'lucide-react';
import { useState } from 'react';

import { ListPagination } from '@/components/shared/list-pagination';
import { usePageAction } from '@/components/shared/page-action';
import { EmptyState } from '@/components/ui/empty-state';
import { RefreshButton } from '@/components/ui/refresh-button';
import { SearchInput } from '@/components/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useListNavigation } from '@/hooks/use-list-navigation';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import type { InvoiceListQuery, InvoicePage } from '@/lib/invoices/list-page';
import { INVOICE_STATUS_LABELS, INVOICE_STATUSES, invoiceStatusSchema } from '@/lib/invoices/types';
import { CreateInvoiceDialog } from './create-invoice-dialog';
import { InvoicesCards, InvoicesTable } from './invoices-list';

const ALL_STATUSES = 'alle';

/**
 * The server selects the page: status, search and count apply in the
 * database before the page boundary, and the URL owns that state. Another
 * session's change reads the page again.
 */
export function InvoicesContent({
  entries,
  total,
  hasAnyInvoice,
  query,
}: InvoicePage & { query: InvoiceListQuery }) {
  // The rows show customer and recipient names, which a customer edit changes.
  useRealtimeRouterRefresh({ tables: ['invoices', 'clients'] });
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
        <InvoicesToolbar
          status={shownStatus}
          search={shownSearch}
          onStatusChange={(value) => {
            setSearch(shownSearch);
            setStatus(value);
            const parsed = invoiceStatusSchema.safeParse(value);
            navigation.navigate({ status: parsed.success ? parsed.data : null, page: 1 });
          }}
          onSearchChange={(value) => {
            setStatus(shownStatus);
            setSearch(value);
            navigation.navigate({ q: value, page: 1 }, 250);
          }}
        />
        <p className="text-sm text-muted-foreground">
          {total} {total === 1 ? 'Rechnung' : 'Rechnungen'}
        </p>
      </div>
      {entries.length === 0 ? (
        <EmptyState
          icon={ReceiptText}
          title={hasAnyInvoice ? 'Keine Rechnungen gefunden' : 'Noch keine Rechnungen'}
          description={
            hasAnyInvoice
              ? 'Zu der Suche gibt es keine Rechnung. Ändere die Suche oder den Status.'
              : 'Erstelle deine erste Rechnung über „Rechnung erstellen“.'
          }
        />
      ) : (
        <>
          <InvoicesCards entries={entries} />
          <InvoicesTable entries={entries} />
        </>
      )}
      <ListPagination
        label="Rechnungen"
        page={query.page}
        total={total}
        busy={navigation.busy}
        onPageChange={(page) => navigation.navigate({ page })}
      />
      {createDialog.open && <CreateInvoiceDialog onClose={() => createDialog.setOpen(false)} />}
    </>
  );
}

/** The status filter, the search and the refresh; stacks on phones. */
function InvoicesToolbar({
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
          {INVOICE_STATUSES.map((value) => (
            <SelectItem key={value} value={value}>
              {INVOICE_STATUS_LABELS[value]}
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
          placeholder="Nummer, Kunde…"
          aria-label="Rechnungen durchsuchen"
        />
        <RefreshButton label="Liste aktualisieren" />
      </div>
    </div>
  );
}
