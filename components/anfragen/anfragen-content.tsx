'use client';

import { EmptyState } from '@/components/ui/empty-state';
import { formatGermanDateTime as formatReceivedAt } from '@/lib/utils';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Inbox } from 'lucide-react';

import { ListPagination } from '@/components/shared/list-pagination';
import { RefreshButton } from '@/components/ui/refresh-button';
import { SearchInput } from '@/components/ui/search-input';
import { ListRow } from '@/components/ui/list-row';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonList, SkeletonRows, type SkeletonColumn } from '@/components/ui/skeleton-table';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useListNavigation } from '@/hooks/use-list-navigation';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import type {
  RequestListEntry,
  RequestListQuery,
  RequestPage,
  RequestStatusFilter,
} from '@/lib/requests/list-page';
import { REQUEST_CATEGORY_LABELS } from '@/lib/requests/types';
import { RequestStatusBadge, RequestUrgencyBadge } from './request-badges';

type AnfragenContentProps = RequestPage & { query: RequestListQuery };

const FILTER_TABS: Array<{ value: RequestStatusFilter; label: string }> = [
  { value: 'aktiv', label: 'Aktiv' },
  { value: 'umgewandelt', label: 'Umgewandelt' },
  { value: 'geschlossen', label: 'Geschlossen' },
  { value: 'alle', label: 'Alle' },
];

// One column definition for the loaded table and its skeleton (design canon):
// header count, widths and hover cannot drift apart.
const BADGE_CELL = <Skeleton className="h-5 w-16 rounded-full" />;
const REQUEST_COLUMNS: readonly SkeletonColumn[] = [
  {
    id: 'number',
    header: 'Nr.',
    className: 'w-[110px]',
    skeleton: <Skeleton className="h-4 w-16" />,
  },
  { id: 'summary', header: 'Anliegen', skeleton: <Skeleton className="h-4 w-3/4" /> },
  {
    id: 'caller',
    header: 'Kunde / Anrufer',
    className: 'w-[18%]',
    skeleton: <Skeleton className="h-4 w-28" />,
  },
  {
    id: 'category',
    header: 'Kategorie',
    className: 'w-[140px]',
    skeleton: <Skeleton className="h-4 w-20" />,
  },
  { id: 'urgency', header: 'Dringlichkeit', className: 'w-[110px]', skeleton: BADGE_CELL },
  { id: 'status', header: 'Status', className: 'w-[120px]', skeleton: BADGE_CELL },
  {
    id: 'receivedAt',
    header: 'Eingegangen',
    className: 'w-[140px]',
    skeleton: <Skeleton className="h-4 w-28" />,
  },
  {
    id: 'assignee',
    header: 'Zuständig',
    className: 'w-[15%]',
    skeleton: <Skeleton className="h-4 w-24" />,
  },
];

function RequestsTableHeader() {
  return (
    <TableHeader>
      <TableRow>
        {REQUEST_COLUMNS.map((column) => (
          <TableHead key={column.id} className={column.className}>
            {column.header}
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
  );
}

/** Same frame as the loaded list; rows hover because loaded rows navigate. */
export function AnfragenTableSkeleton({ count }: { count: number }) {
  return (
    <>
      <SkeletonList count={count} interactive className="md:hidden">
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-5 w-2/3" />
            {BADGE_CELL}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-24" />
          </div>
          <div className="mt-1.5">{BADGE_CELL}</div>
        </div>
      </SkeletonList>
      <div className="hidden md:block">
        <Table>
          <RequestsTableHeader />
          <TableBody>
            <SkeletonRows columns={REQUEST_COLUMNS} rows={count} interactive />
          </TableBody>
        </Table>
      </div>
    </>
  );
}

function requestCallerLabel(entry: RequestListEntry): string {
  if (entry.clientName) return entry.clientName;
  if (entry.request.callerName) return `${entry.request.callerName} (neu)`;
  return 'Unbekannte/r Anrufer/in';
}

/**
 * The server selects the page: status scope, search and the count apply in
 * the database before the page boundary, and the URL owns that state. A
 * Realtime event reads the current selection again.
 */
export function AnfragenContent({ entries, total, hasAnyRequest, query }: AnfragenContentProps) {
  const router = useRouter();
  const navigation = useListNavigation();
  // The typed text and the chosen tab stay ahead of the URL while the read is
  // under way, so both react in the first frame.
  const [search, setSearch] = useState(query.search);
  const [status, setStatus] = useState(query.status);
  const shownSearch = navigation.busy ? search : query.search;
  const shownStatus = navigation.busy ? status : query.status;

  useRealtimeRouterRefresh({
    tables: ['client_requests', 'clients'],
  });

  return (
    <>
      <div className="mb-4 flex flex-col gap-3">
        {/* Stacks on phones: side by side, the search input shrank to nothing
            under the refresh icon and tapping "refresh" opened the keyboard. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs
            value={shownStatus}
            onValueChange={(value) => {
              // Both echoes describe the same pending URL.
              setSearch(shownSearch);
              setStatus(value as RequestStatusFilter);
              navigation.navigate({ status: value, page: 1 });
            }}
            className="min-w-0"
          >
            <TabsList className="h-9 max-w-full justify-start overflow-x-auto">
              {FILTER_TABS.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value} className="shrink-0">
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="flex min-w-0 items-center gap-2 sm:flex-1 sm:justify-end">
            <SearchInput
              wrapperClassName="min-w-0 flex-1 sm:max-w-xs"
              value={shownSearch}
              onValueChange={(value) => {
                setStatus(shownStatus);
                setSearch(value);
                navigation.navigate({ q: value, page: 1 }, 250);
              }}
              className="h-8"
              placeholder="Anliegen, Kunde, Nummer…"
              aria-label="Anfragen durchsuchen"
            />
            <RefreshButton label="Liste aktualisieren" />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {total} {total === 1 ? 'Anfrage' : 'Anfragen'}
        </p>
      </div>

      {entries.length === 0 ? (
        !hasAnyRequest ? (
          <EmptyState
            icon={Inbox}
            title="Noch keine Anfragen"
            description="Erfasse eine Anfrage direkt während des nächsten Anrufs über „Anfrage erfassen“."
          />
        ) : (
          <EmptyState
            icon={Inbox}
            title="Keine Anfragen gefunden"
            description="Zu den aktuellen Filtern gibt es keine Anfrage. Ändere die Filter oder die Suche."
          />
        )
      ) : (
        <>
          {/* Mobile view - card layout (a real link for keyboard/middle-click) */}
          <div className="space-y-2 md:hidden">
            {entries.map((entry) => (
              <ListRow key={entry.request.id} asChild interactive>
                <Link
                  href={`/anfragen/${entry.request.id}`}
                  aria-label={`Anfrage öffnen: ${entry.request.summary}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-sm font-medium">{entry.request.summary}</p>
                      <RequestStatusBadge status={entry.request.status} />
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                      <span className="truncate">{requestCallerLabel(entry)}</span>
                      <span className="text-muted-foreground/60">&middot;</span>
                      <span>{REQUEST_CATEGORY_LABELS[entry.request.category]}</span>
                      <span className="text-muted-foreground/60">&middot;</span>
                      <span>{formatReceivedAt(entry.request.receivedAt)}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <RequestUrgencyBadge urgency={entry.request.urgency} />
                      {entry.convertedLabel && (
                        <span className="text-xs text-muted-foreground">→ {entry.convertedLabel}</span>
                      )}
                    </div>
                  </div>
                </Link>
              </ListRow>
            ))}
          </div>

          {/* Desktop view - table layout */}
          <div className="hidden md:block">
            <Table>
              <RequestsTableHeader />
              <TableBody>
                {entries.map((entry) => (
                  <TableRow
                    key={entry.request.id}
                    interactive
                    onClick={() => router.push(`/anfragen/${entry.request.id}`)}
                    onMouseEnter={() => router.prefetch(`/anfragen/${entry.request.id}`)}
                    onFocus={() => router.prefetch(`/anfragen/${entry.request.id}`)}
                  >
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {entry.request.requestNumber || '—'}
                    </TableCell>
                    <TableCell className="max-w-0">
                      {/* Real link inside the clickable row for keyboard users,
                          middle-click, and Cmd+Click. */}
                      <Link
                        href={`/anfragen/${entry.request.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="block truncate font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-sm"
                      >
                        {entry.request.summary}
                      </Link>
                      {entry.convertedLabel && (
                        <p className="truncate text-xs text-muted-foreground">→ {entry.convertedLabel}</p>
                      )}
                    </TableCell>
                    <TableCell className="max-w-0">
                      <p className="truncate">{requestCallerLabel(entry)}</p>
                    </TableCell>
                    <TableCell>{REQUEST_CATEGORY_LABELS[entry.request.category]}</TableCell>
                    <TableCell>
                      <RequestUrgencyBadge urgency={entry.request.urgency} />
                    </TableCell>
                    <TableCell>
                      <RequestStatusBadge status={entry.request.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatReceivedAt(entry.request.receivedAt)}
                    </TableCell>
                    <TableCell className="max-w-0">
                      <p className="truncate">{entry.assigneeName || '—'}</p>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
      <ListPagination
        label="Anfragen"
        page={query.page}
        total={total}
        busy={navigation.busy}
        onPageChange={(page) => navigation.navigate({ page })}
      />
    </>
  );
}
