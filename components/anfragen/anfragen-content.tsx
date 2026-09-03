'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Inbox, Search } from 'lucide-react';

import { RefreshButton } from '@/components/ui/refresh-button';
import { Input } from '@/components/ui/input';
import { ListRow } from '@/components/ui/list-row';
import { Skeleton } from '@/components/ui/skeleton';
import {
  SkeletonList,
  SkeletonRows,
  type SkeletonColumn,
} from '@/components/ui/skeleton-table';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import {
  REQUEST_CATEGORY_LABELS,
  type ClientRequest,
  type RequestStatus,
} from '@/lib/requests/types';
import { RequestStatusBadge, RequestUrgencyBadge } from './request-badges';

export type RequestListEntry = {
  request: ClientRequest;
  clientName: string | null;
  assigneeName: string | null;
  convertedLabel: string | null;
};

interface AnfragenContentProps {
  entries: RequestListEntry[];
}

type StatusFilter = 'aktiv' | RequestStatus | 'alle';

const FILTER_TABS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'aktiv', label: 'Aktiv' },
  { value: 'umgewandelt', label: 'Umgewandelt' },
  { value: 'geschlossen', label: 'Geschlossen' },
  { value: 'alle', label: 'Alle' },
];

// One column definition for the loaded table and its skeleton (design canon):
// header count, widths and hover cannot drift apart.
const BADGE_CELL = <Skeleton className="h-5 w-16 rounded-full" />;
export const REQUEST_COLUMNS: readonly SkeletonColumn[] = [
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

function formatReceivedAt(receivedAt: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(receivedAt));
}

function requestCallerLabel(entry: RequestListEntry): string {
  if (entry.clientName) return entry.clientName;
  if (entry.request.callerName) return `${entry.request.callerName} (neu)`;
  return 'Unbekannte/r Anrufer/in';
}

export function AnfragenContent({ entries }: AnfragenContentProps) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('aktiv');

  useRealtimeRouterRefresh({
    tables: ['client_requests', 'clients'],
  });

  const filteredEntries = useMemo(() => {
    const query = search.trim().toLowerCase();
    return entries.filter((entry) => {
      const { request } = entry;
      if (statusFilter === 'aktiv') {
        if (request.status !== 'offen' && request.status !== 'in_klaerung') {
          return false;
        }
      } else if (statusFilter !== 'alle' && request.status !== statusFilter) {
        return false;
      }

      if (!query) return true;
      const haystack = [
        request.summary,
        request.details,
        request.requestNumber,
        entry.clientName,
        request.callerName,
        request.callerPhone,
        request.callerEmail,
        entry.assigneeName,
        REQUEST_CATEGORY_LABELS[request.category],
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [entries, search, statusFilter]);

  return (
    <>
      <div className="mb-4 flex flex-col gap-3">
        {/* Stacks on phones: side by side, the search input shrank to nothing
            under the refresh icon and tapping "refresh" opened the keyboard. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as StatusFilter)}
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
            <div className="relative min-w-0 flex-1 sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-9"
                placeholder="Anliegen, Kunde, Nummer..."
                aria-label="Anfragen durchsuchen"
              />
            </div>
            <RefreshButton label="Liste aktualisieren" />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {filteredEntries.length}{' '}
          {filteredEntries.length === 1 ? 'Anfrage' : 'Anfragen'}
        </p>
      </div>

      {filteredEntries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted">
            <Inbox className="size-6 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold">Keine Anfragen</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {entries.length === 0
              ? 'Erfasse eine Anfrage direkt während des nächsten Anrufs über „Anfrage erfassen“.'
              : 'Für die aktuelle Filterung gibt es keine Anfragen.'}
          </p>
        </div>
      ) : (
        <>
          {/* Mobile view - card layout (a real link for keyboard/middle-click) */}
          <div className="space-y-2 md:hidden">
            {filteredEntries.map((entry) => (
              <ListRow key={entry.request.id} asChild interactive>
                <Link
                  href={`/anfragen/${entry.request.id}`}
                  aria-label={`Anfrage öffnen: ${entry.request.summary}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-sm font-medium">
                        {entry.request.summary}
                      </p>
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
                        <span className="text-xs text-muted-foreground">
                          → {entry.convertedLabel}
                        </span>
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
                {filteredEntries.map((entry) => (
                  <TableRow
                    key={entry.request.id}
                    interactive
                    onClick={() => router.push(`/anfragen/${entry.request.id}`)}
                  >
                    <TableCell className="text-muted-foreground">
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
                        <p className="truncate text-xs text-muted-foreground">
                          → {entry.convertedLabel}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="max-w-0">
                      <p className="truncate">{requestCallerLabel(entry)}</p>
                    </TableCell>
                    <TableCell>
                      {REQUEST_CATEGORY_LABELS[entry.request.category]}
                    </TableCell>
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
    </>
  );
}
